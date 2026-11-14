import { and, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/index.ts';
import {
  briefings,
  citizenAdvisories,
  datasets,
  recommendations,
} from '../../db/schema.ts';
import {
  generateAdvisorySchema,
  generateBriefingSchema,
  updateBriefingStatusSchema,
  updateRecommendationStatusSchema,
} from '../../shared/schemas/index.ts';
import { AuthenticatedRequest, requireAuth, requireOrgAccess } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import { generateCitizenAdvisories } from '../services/ai/advisoryGenerator.ts';
import { generateAndStoreBriefing } from '../services/ai/briefingGenerator.ts';
import { recordAuditLog } from '../services/auditService.ts';
import { generateBriefingPdfBuffer } from '../services/export/pdfExporter.ts';
import { createBackgroundJob, updateBackgroundJob } from '../services/jobs/jobManager.ts';
import {
  assertBriefingWithinAssignedLocations,
  isBriefingWithinAssignedLocations,
} from '../utils/locationScope.ts';

export const briefingRoutes = Router();

function parsePositiveId(raw: string | string[], label = 'ID'): number {
  const str = Array.isArray(raw) ? raw[0] : raw;
  const num = Number(str);
  if (!Number.isInteger(num) || num <= 0) {
    throw new AppError(400, 'INVALID_ID', `Invalid ${label}.`);
  }
  return num;
}

const WRITE_ROLES = [
  'org_admin',
  'ward_officer',
  'housing_manager',
  'school_admin',
  'analyst',
] as const;

const PUBLISH_ROLES = [
  'org_admin',
  'ward_officer',
  'housing_manager',
  'school_admin',
] as const;

async function loadFullBriefing(
  organizationId: number,
  briefingId: number,
  assignedLocations: string[] = [],
) {
  const [row] = await db
    .select()
    .from(briefings)
    .where(and(eq(briefings.id, briefingId), eq(briefings.organizationId, organizationId)))
    .limit(1);

  if (!row) {
    throw new AppError(404, 'BRIEFING_NOT_FOUND', 'Briefing not found.');
  }

  await assertBriefingWithinAssignedLocations({
    briefingId: row.id,
    statisticalRunId: row.statisticalRunId,
    structuredFindingsJson: row.structuredFindingsJson,
    assignedLocations,
  });

  const [dataset] = await db
    .select({ id: datasets.id, title: datasets.title })
    .from(datasets)
    .where(eq(datasets.id, row.datasetId))
    .limit(1);

  const recs = await db
    .select()
    .from(recommendations)
    .where(eq(recommendations.briefingId, row.id));

  const advisories = await db
    .select()
    .from(citizenAdvisories)
    .where(eq(citizenAdvisories.briefingId, row.id));

  return {
    id: row.id,
    organizationId: row.organizationId,
    datasetId: row.datasetId,
    datasetTitle: dataset?.title || `Dataset #${row.datasetId}`,
    statisticalRunId: row.statisticalRunId,
    stakeholderType: row.stakeholderType,
    title: row.title,
    executiveSummary: row.executiveSummary,
    structuredFindings: JSON.parse(row.structuredFindingsJson),
    dataQualityNotes: JSON.parse(row.dataQualityNotesJson),
    risksAndUncertainties: JSON.parse(row.risksAndUncertaintiesJson),
    aiMetadata: JSON.parse(row.aiMetadataJson),
    status: row.status,
    createdAt: row.createdAt,
    recommendations: recs.map((r) => ({
      ...r,
      evidenceRefs: JSON.parse(r.evidenceRefsJson),
    })),
    advisories,
  };
}

briefingRoutes.post(
  '/generate',
  requireAuth,
  requireOrgAccess(WRITE_ROLES),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = generateBriefingSchema.parse(req.body);
      const { briefingId } = await generateAndStoreBriefing({
        organizationId: req.org!.organizationId,
        userId: req.auth!.userId,
        datasetId: body.datasetId,
        stakeholderType: body.stakeholderType,
        assignedLocations: req.org!.assignedLocations,
        titleOverride: body.title,
      });

      const full = await loadFullBriefing(
        req.org!.organizationId,
        briefingId,
        req.org!.assignedLocations,
      );
      res.status(201).json({ briefing: full });
    } catch (err) {
      next(err);
    }
  },
);

briefingRoutes.post(
  '/generate-async',
  requireAuth,
  requireOrgAccess(WRITE_ROLES),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = generateBriefingSchema.parse(req.body);
      const orgId = req.org!.organizationId;
      const userId = req.auth!.userId;
      const assignedLocations = req.org!.assignedLocations;

      const jobId = await createBackgroundJob({
        organizationId: orgId,
        jobType: 'generate_briefing',
        payload: { datasetId: body.datasetId, stakeholderType: body.stakeholderType },
      });

      setImmediate(async () => {
        try {
          await updateBackgroundJob(jobId, { status: 'running', progressPct: 25 });
          const { briefingId } = await generateAndStoreBriefing({
            organizationId: orgId,
            userId,
            datasetId: body.datasetId,
            stakeholderType: body.stakeholderType,
            assignedLocations,
            titleOverride: body.title,
          });
          await updateBackgroundJob(jobId, {
            status: 'completed',
            progressPct: 100,
            resultRef: { briefingId },
          });
        } catch (err: unknown) {
          await updateBackgroundJob(jobId, {
            status: 'failed',
            errorMessage: err instanceof Error ? err.message : 'Async briefing failed.',
          });
        }
      });

      res.status(202).json({ jobId });
    } catch (err) {
      next(err);
    }
  },
);

briefingRoutes.get(
  '/',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const orgId = req.org!.organizationId;
      const assignedLocations = req.org!.assignedLocations;
      const stakeholderFilter =
        typeof req.query.stakeholderType === 'string' ? req.query.stakeholderType : undefined;
      const search = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';

      const rows = await db
        .select({
          id: briefings.id,
          datasetId: briefings.datasetId,
          statisticalRunId: briefings.statisticalRunId,
          stakeholderType: briefings.stakeholderType,
          title: briefings.title,
          executiveSummary: briefings.executiveSummary,
          structuredFindingsJson: briefings.structuredFindingsJson,
          status: briefings.status,
          aiMetadataJson: briefings.aiMetadataJson,
          createdAt: briefings.createdAt,
        })
        .from(briefings)
        .where(
          stakeholderFilter
            ? and(
                eq(briefings.organizationId, orgId),
                eq(briefings.stakeholderType, stakeholderFilter),
              )
            : eq(briefings.organizationId, orgId),
        )
        .orderBy(desc(briefings.id))
        .limit(100);

      const searchFiltered = search
        ? rows.filter(
            (r) =>
              r.title.toLowerCase().includes(search) ||
              r.executiveSummary.toLowerCase().includes(search) ||
              r.stakeholderType.toLowerCase().includes(search),
          )
        : rows;

      const scopedRows =
        assignedLocations.length > 0
          ? (
              await Promise.all(
                searchFiltered.map(async (r) =>
                  (await isBriefingWithinAssignedLocations({
                    briefingId: r.id,
                    statisticalRunId: r.statisticalRunId,
                    structuredFindingsJson: r.structuredFindingsJson,
                    assignedLocations,
                  }))
                    ? r
                    : null,
                ),
              )
            ).filter((r): r is NonNullable<typeof r> => r !== null)
          : searchFiltered;

      res.json({
        briefings: scopedRows.map((r) => ({
          id: r.id,
          datasetId: r.datasetId,
          stakeholderType: r.stakeholderType,
          title: r.title,
          executiveSummary: r.executiveSummary,
          status: r.status,
          aiMetadata: JSON.parse(r.aiMetadataJson),
          createdAt: r.createdAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

briefingRoutes.get(
  '/:id',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const briefing = await loadFullBriefing(
        req.org!.organizationId,
        parsePositiveId(req.params.id, 'briefingId'),
        req.org!.assignedLocations,
      );
      res.json({ briefing });
    } catch (err) {
      next(err);
    }
  },
);

briefingRoutes.patch(
  '/:id/status',
  requireAuth,
  requireOrgAccess(PUBLISH_ROLES),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = updateBriefingStatusSchema.parse(req.body);
      const orgId = req.org!.organizationId;
      const briefingId = parsePositiveId(req.params.id, 'briefingId');
      const assignedLocations = req.org!.assignedLocations;

      const [existing] = await db
        .select()
        .from(briefings)
        .where(and(eq(briefings.id, briefingId), eq(briefings.organizationId, orgId)))
        .limit(1);

      if (!existing) {
        throw new AppError(404, 'BRIEFING_NOT_FOUND', 'Briefing not found.');
      }

      await assertBriefingWithinAssignedLocations({
        briefingId: existing.id,
        statisticalRunId: existing.statisticalRunId,
        structuredFindingsJson: existing.structuredFindingsJson,
        assignedLocations,
      });

      await db
        .update(briefings)
        .set({ status: body.status })
        .where(and(eq(briefings.id, briefingId), eq(briefings.organizationId, orgId)))
        .run();

      await recordAuditLog({
        organizationId: orgId,
        actorUserId: req.auth!.userId,
        action: 'BRIEFING_STATUS_UPDATED',
        resourceType: 'briefing',
        resourceId: briefingId,
        metadata: { status: body.status },
      });

      const full = await loadFullBriefing(orgId, briefingId, assignedLocations);
      res.json({ briefing: full });
    } catch (err) {
      next(err);
    }
  },
);

briefingRoutes.patch(
  '/recommendations/:recId',
  requireAuth,
  requireOrgAccess(PUBLISH_ROLES),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = updateRecommendationStatusSchema.parse(req.body);
      const orgId = req.org!.organizationId;
      const recId = parsePositiveId(req.params.recId, 'recommendationId');

      const [existingRec] = await db
        .select()
        .from(recommendations)
        .where(and(eq(recommendations.id, recId), eq(recommendations.organizationId, orgId)))
        .limit(1);

      if (!existingRec) {
        throw new AppError(404, 'RECOMMENDATION_NOT_FOUND', 'Recommendation not found.');
      }

      if (req.org!.assignedLocations.length > 0) {
        const [parentBriefing] = await db
          .select()
          .from(briefings)
          .where(and(eq(briefings.id, existingRec.briefingId), eq(briefings.organizationId, orgId)))
          .limit(1);

        if (parentBriefing) {
          await assertBriefingWithinAssignedLocations({
            briefingId: parentBriefing.id,
            statisticalRunId: parentBriefing.statisticalRunId,
            structuredFindingsJson: parentBriefing.structuredFindingsJson,
            assignedLocations: req.org!.assignedLocations,
          });
        }
      }

      const updated = await db
        .update(recommendations)
        .set({ status: body.status })
        .where(and(eq(recommendations.id, recId), eq(recommendations.organizationId, orgId)))
        .returning()
        .get();

      await recordAuditLog({
        organizationId: orgId,
        actorUserId: req.auth!.userId,
        action: 'RECOMMENDATION_STATUS_UPDATED',
        resourceType: 'recommendation',
        resourceId: recId,
        metadata: { status: body.status },
      });

      res.json({
        recommendation: {
          ...updated,
          evidenceRefs: JSON.parse(updated.evidenceRefsJson),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

briefingRoutes.post(
  '/:id/advisories',
  requireAuth,
  requireOrgAccess(WRITE_ROLES),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = generateAdvisorySchema.parse(req.body);
      const briefingId = parsePositiveId(req.params.id, 'briefingId');
      const orgId = req.org!.organizationId;

      if (req.org!.assignedLocations.length > 0) {
        const [row] = await db
          .select()
          .from(briefings)
          .where(and(eq(briefings.id, briefingId), eq(briefings.organizationId, orgId)))
          .limit(1);
        if (!row) {
          throw new AppError(404, 'BRIEFING_NOT_FOUND', 'Briefing not found.');
        }
        await assertBriefingWithinAssignedLocations({
          briefingId: row.id,
          statisticalRunId: row.statisticalRunId,
          structuredFindingsJson: row.structuredFindingsJson,
          assignedLocations: req.org!.assignedLocations,
        });
      }

      const { cacheHit } = await generateCitizenAdvisories({
        organizationId: orgId,
        userId: req.auth!.userId,
        briefingId,
        readingLevel: body.readingLevel,
        languages: body.languages,
        forceRegenerate: body.forceRegenerate,
      });

      const advisories = await db
        .select()
        .from(citizenAdvisories)
        .where(
          and(
            eq(citizenAdvisories.briefingId, briefingId),
            eq(citizenAdvisories.organizationId, orgId),
          ),
        );

      res.status(cacheHit ? 200 : 201).json({ advisories, cacheHit });
    } catch (err) {
      next(err);
    }
  },
);

briefingRoutes.get(
  '/:id/advisories',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const briefingId = parsePositiveId(req.params.id, 'briefingId');
      const orgId = req.org!.organizationId;

      if (req.org!.assignedLocations.length > 0) {
        const [row] = await db
          .select()
          .from(briefings)
          .where(and(eq(briefings.id, briefingId), eq(briefings.organizationId, orgId)))
          .limit(1);
        if (!row) {
          throw new AppError(404, 'BRIEFING_NOT_FOUND', 'Briefing not found.');
        }
        await assertBriefingWithinAssignedLocations({
          briefingId: row.id,
          statisticalRunId: row.statisticalRunId,
          structuredFindingsJson: row.structuredFindingsJson,
          assignedLocations: req.org!.assignedLocations,
        });
      }

      const advisories = await db
        .select()
        .from(citizenAdvisories)
        .where(
          and(
            eq(citizenAdvisories.briefingId, briefingId),
            eq(citizenAdvisories.organizationId, orgId),
          ),
        );

      res.json({ advisories });
    } catch (err) {
      next(err);
    }
  },
);

briefingRoutes.get(
  '/:id/export/pdf',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { filename, buffer } = await generateBriefingPdfBuffer({
        organizationId: req.org!.organizationId,
        userId: req.auth!.userId,
        briefingId: parsePositiveId(req.params.id, 'briefingId'),
        assignedLocations: req.org!.assignedLocations,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
);

import { and, desc, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/index.ts';
import { briefingComparisons, briefings } from '../../db/schema.ts';
import { compareBriefingsSchema } from '../../shared/schemas/index.ts';
import { AuthenticatedRequest, requireAuth, requireOrgAccess } from '../middleware/auth.ts';
import { compareBriefings } from '../services/analytics/comparisonEngine.ts';
import { isBriefingWithinAssignedLocations } from '../utils/locationScope.ts';

export const comparisonRoutes = Router();

const WRITE_ROLES = [
  'org_admin',
  'ward_officer',
  'housing_manager',
  'school_admin',
  'analyst',
] as const;

comparisonRoutes.post(
  '/',
  requireAuth,
  requireOrgAccess(WRITE_ROLES),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = compareBriefingsSchema.parse(req.body);
      const comparison = await compareBriefings({
        organizationId: req.org!.organizationId,
        userId: req.auth!.userId,
        currentBriefingId: body.currentBriefingId,
        previousBriefingId: body.previousBriefingId,
        assignedLocations: req.org!.assignedLocations,
      });
      res.status(201).json({ comparison });
    } catch (err) {
      next(err);
    }
  },
);

comparisonRoutes.get(
  '/',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const orgId = req.org!.organizationId;
      const assignedLocations = req.org!.assignedLocations;

      const rows = await db
        .select()
        .from(briefingComparisons)
        .where(eq(briefingComparisons.organizationId, orgId))
        .orderBy(desc(briefingComparisons.id))
        .limit(30);

      let visibleRows = rows;
      if (assignedLocations.length > 0 && rows.length > 0) {
        const briefingIds = Array.from(
          new Set(rows.flatMap((r) => [r.currentBriefingId, r.previousBriefingId])),
        );
        const briefRows = await db
          .select({
            id: briefings.id,
            statisticalRunId: briefings.statisticalRunId,
            structuredFindingsJson: briefings.structuredFindingsJson,
          })
          .from(briefings)
          .where(and(eq(briefings.organizationId, orgId), inArray(briefings.id, briefingIds)));

        const allowedBriefingIds = new Set<number>();
        await Promise.all(
          briefRows.map(async (b) => {
            const ok = await isBriefingWithinAssignedLocations({
              briefingId: b.id,
              statisticalRunId: b.statisticalRunId,
              structuredFindingsJson: b.structuredFindingsJson,
              assignedLocations,
            });
            if (ok) allowedBriefingIds.add(b.id);
          }),
        );

        visibleRows = rows.filter(
          (r) =>
            allowedBriefingIds.has(r.currentBriefingId) &&
            allowedBriefingIds.has(r.previousBriefingId),
        );
      }

      res.json({
        comparisons: visibleRows.map((r) => ({
          id: r.id,
          currentBriefingId: r.currentBriefingId,
          previousBriefingId: r.previousBriefingId,
          isComparable: r.isComparable,
          incomparabilityReasons: JSON.parse(r.incomparabilityReasonsJson),
          deltaMetrics: JSON.parse(r.deltaMetricsJson),
          summaryNarrative: r.summaryNarrative,
          createdAt: r.createdAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

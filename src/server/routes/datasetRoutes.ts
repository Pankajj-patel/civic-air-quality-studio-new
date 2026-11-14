import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { db } from '../../db/index.ts';
import {
  datasetMappings,
  datasets,
  hotspots,
  normalizedReadings,
  rawRecords,
  statisticalRuns,
} from '../../db/schema.ts';
import {
  confirmMappingSchema,
  pasteOrManualUploadSchema,
} from '../../shared/schemas/index.ts';
import { AuthenticatedRequest, requireAuth, requireOrgAccess } from '../middleware/auth.ts';
import { AppError } from '../middleware/errorHandler.ts';
import { runDeterministicAnalytics } from '../services/analytics/statsEngine.ts';
import { recordAuditLog } from '../services/auditService.ts';
import { normalizeDatasetRecords } from '../services/ingestion/normalizer.ts';
import {
  detectSchemaFromRows,
  parseCsvString,
  parseUploadedFileBuffer,
  sanitizeSpreadsheetCell,
} from '../services/ingestion/parser.ts';
import { createBackgroundJob, updateBackgroundJob } from '../services/jobs/jobManager.ts';
import { sha256Hex } from '../utils/crypto.ts';

export const datasetRoutes = Router();

function parsePositiveId(raw: string | string[], label = 'ID'): number {
  const str = Array.isArray(raw) ? raw[0] : raw;
  const num = Number(str);
  if (!Number.isInteger(num) || num <= 0) {
    throw new AppError(400, 'INVALID_ID', `Invalid ${label}.`);
  }
  return num;
}

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const WRITE_ROLES = [
  'org_admin',
  'ward_officer',
  'housing_manager',
  'school_admin',
  'analyst',
] as const;

datasetRoutes.post(
  '/upload',
  requireAuth,
  requireOrgAccess(WRITE_ROLES),
  uploadMiddleware.single('file'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const orgId = req.org!.organizationId;
      const userId = req.auth!.userId;

      let title: string;
      let sourceType: 'csv' | 'xlsx' | 'paste' | 'manual';
      let originalFilename: string | null = null;
      let fileHash: string;
      let rows: Record<string, string>[];
      let detectedSchema: ReturnType<typeof detectSchemaFromRows>;

      if (req.file) {
        const parsed = parseUploadedFileBuffer(
          req.file.originalname,
          req.file.buffer,
          typeof req.body?.title === 'string' ? req.body.title : undefined,
          req.file.mimetype,
        );
        title = parsed.title;
        sourceType = parsed.sourceType;
        originalFilename = parsed.originalFilename ?? null;
        fileHash = sha256Hex(req.file.buffer);
        rows = parsed.rows;
        detectedSchema = parsed.detectedSchema;
      } else {
        const body = pasteOrManualUploadSchema.parse(req.body);
        title = body.title;
        sourceType = body.sourceType;

        if (body.sourceType === 'paste') {
          if (!body.rawText) {
            throw new AppError(400, 'MISSING_TEXT', 'Provide tabular rawText for paste upload.');
          }
          const csvParsed = parseCsvString(body.rawText);
          rows = csvParsed.rows;
          detectedSchema = detectSchemaFromRows(csvParsed.headers, rows);
          fileHash = sha256Hex(body.rawText);
        } else {
          if (!body.rows || body.rows.length === 0) {
            throw new AppError(400, 'MISSING_ROWS', 'Provide at least one manual row.');
          }
          const headers = Array.from(
            new Set(body.rows.flatMap((r) => Object.keys(r).map((k) => k.trim()))),
          )
            .filter(Boolean)
            .slice(0, 100);
          rows = body.rows.map((r) => {
            const out: Record<string, string> = {};
            for (const h of headers) out[h] = sanitizeSpreadsheetCell(r[h]);
            return out;
          });
          detectedSchema = detectSchemaFromRows(headers, rows);
          fileHash = sha256Hex(JSON.stringify(rows));
        }
      }

      const createdDataset = db.transaction((tx) => {
        const ds = tx
          .insert(datasets)
          .values({
            organizationId: orgId,
            uploadedBy: userId,
            title,
            sourceType,
            originalFilename,
            fileHash,
            rowCount: rows.length,
            status: 'pending_mapping',
          })
          .returning()
          .get();

        tx.insert(datasetMappings)
          .values({
            datasetId: ds.id,
            detectedSchemaJson: JSON.stringify(detectedSchema),
          })
          .run();

        const rawValues = rows.map((row, index) => ({
          datasetId: ds.id,
          rowIndex: index + 1,
          rawPayloadJson: JSON.stringify(row),
          parseWarningsJson: '[]',
        }));

        const CHUNK = 250;
        for (let i = 0; i < rawValues.length; i += CHUNK) {
          tx.insert(rawRecords).values(rawValues.slice(i, i + CHUNK)).run();
        }

        return ds;
      });

      await recordAuditLog({
        organizationId: orgId,
        actorUserId: userId,
        action: 'DATASET_UPLOADED',
        resourceType: 'dataset',
        resourceId: createdDataset.id,
        metadata: { title, sourceType, rowCount: rows.length },
      });

      res.status(201).json({
        dataset: createdDataset,
        detectedSchema,
        previewRows: rows.slice(0, 25),
      });
    } catch (err) {
      next(err);
    }
  },
);

datasetRoutes.get(
  '/',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const orgId = req.org!.organizationId;
      const list = await db
        .select()
        .from(datasets)
        .where(eq(datasets.organizationId, orgId))
        .orderBy(desc(datasets.id))
        .limit(50);

      res.json({ datasets: list });
    } catch (err) {
      next(err);
    }
  },
);

datasetRoutes.get(
  '/:id/preview',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const orgId = req.org!.organizationId;
      const datasetId = parsePositiveId(req.params.id, 'datasetId');

      const [ds] = await db
        .select()
        .from(datasets)
        .where(and(eq(datasets.id, datasetId), eq(datasets.organizationId, orgId)))
        .limit(1);

      if (!ds) {
        throw new AppError(404, 'DATASET_NOT_FOUND', 'Dataset not found.');
      }

      const [mapping] = await db
        .select()
        .from(datasetMappings)
        .where(eq(datasetMappings.datasetId, datasetId))
        .limit(1);

      const previewRaw = await db
        .select()
        .from(rawRecords)
        .where(eq(rawRecords.datasetId, datasetId))
        .limit(25);

      res.json({
        dataset: ds,
        detectedSchema: mapping ? JSON.parse(mapping.detectedSchemaJson) : null,
        confirmedMapping: mapping?.confirmedMappingJson
          ? JSON.parse(mapping.confirmedMappingJson)
          : null,
        previewRows: previewRaw.map((r) => JSON.parse(r.rawPayloadJson)),
      });
    } catch (err) {
      next(err);
    }
  },
);

datasetRoutes.post(
  '/:id/confirm-mapping',
  requireAuth,
  requireOrgAccess(WRITE_ROLES),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const orgId = req.org!.organizationId;
      const userId = req.auth!.userId;
      const datasetId = parsePositiveId(req.params.id, 'datasetId');
      const mapping = confirmMappingSchema.parse(req.body);

      const [ds] = await db
        .select()
        .from(datasets)
        .where(and(eq(datasets.id, datasetId), eq(datasets.organizationId, orgId)))
        .limit(1);

      if (!ds) {
        throw new AppError(404, 'DATASET_NOT_FOUND', 'Dataset not found.');
      }

      await db
        .update(datasets)
        .set({ status: 'normalizing' })
        .where(eq(datasets.id, datasetId));

      const useAsync = ds.rowCount > 1500 || req.query.async === 'true';
      const standard = req.org!.defaultAqiStandard;

      if (useAsync) {
        const jobId = await createBackgroundJob({
          organizationId: orgId,
          jobType: 'normalize_dataset',
          payload: { datasetId, rowCount: ds.rowCount },
        });

        setImmediate(async () => {
          try {
            await updateBackgroundJob(jobId, { status: 'running', progressPct: 20 });
            const normResult = await normalizeDatasetRecords({
              organizationId: orgId,
              datasetId,
              userId,
              aqiStandard: standard,
              mapping,
            });
            await updateBackgroundJob(jobId, { status: 'running', progressPct: 70 });
            const statsResult = await runDeterministicAnalytics({
              organizationId: orgId,
              datasetId,
              aqiStandard: standard,
            });
            await recordAuditLog({
              organizationId: orgId,
              actorUserId: userId,
              action: 'MAPPING_CONFIRMED_AND_ANALYZED',
              resourceType: 'dataset',
              resourceId: datasetId,
              metadata: {
                normalizedRows: normResult.totalNormalizedRows,
                statisticalRunId: statsResult.statisticalRunId,
                hotspotCount: statsResult.hotspotCount,
                asyncJobId: jobId,
              },
            });
            await updateBackgroundJob(jobId, {
              status: 'completed',
              progressPct: 100,
              resultRef: { datasetId, statisticalRunId: statsResult.statisticalRunId },
            });
          } catch (normErr: unknown) {
            const msg =
              normErr instanceof Error ? normErr.message : 'Normalization pipeline failed.';
            await db
              .update(datasets)
              .set({ status: 'failed', errorMessage: msg })
              .where(eq(datasets.id, datasetId));
            await updateBackgroundJob(jobId, { status: 'failed', errorMessage: msg });
          }
        });

        res.status(202).json({
          async: true,
          jobId,
          dataset: { ...ds, status: 'normalizing' },
        });
        return;
      }

      let normResult: Awaited<ReturnType<typeof normalizeDatasetRecords>>;
      let statsResult: Awaited<ReturnType<typeof runDeterministicAnalytics>>;
      try {
        normResult = await normalizeDatasetRecords({
          organizationId: orgId,
          datasetId,
          userId,
          aqiStandard: standard,
          mapping,
        });

        statsResult = await runDeterministicAnalytics({
          organizationId: orgId,
          datasetId,
          aqiStandard: standard,
        });
      } catch (normErr: unknown) {
        await db
          .update(datasets)
          .set({
            status: 'failed',
            errorMessage:
              normErr instanceof Error ? normErr.message : 'Normalization pipeline failed.',
          })
          .where(eq(datasets.id, datasetId));
        throw normErr;
      }

      await recordAuditLog({
        organizationId: orgId,
        actorUserId: userId,
        action: 'MAPPING_CONFIRMED_AND_ANALYZED',
        resourceType: 'dataset',
        resourceId: datasetId,
        metadata: {
          normalizedRows: normResult.totalNormalizedRows,
          statisticalRunId: statsResult.statisticalRunId,
          hotspotCount: statsResult.hotspotCount,
        },
      });

      const [updatedDataset] = await db
        .select()
        .from(datasets)
        .where(eq(datasets.id, datasetId))
        .limit(1);

      res.json({
        dataset: updatedDataset,
        normalization: normResult,
        statisticalRunId: statsResult.statisticalRunId,
        globalSummary: statsResult.globalSummary,
        locationSummaries: statsResult.locationSummaries,
        dataQualityReport: statsResult.dataQualityReport,
      });
    } catch (err) {
      next(err);
    }
  },
);

datasetRoutes.get(
  '/:id/stats',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const orgId = req.org!.organizationId;
      const datasetId = parsePositiveId(req.params.id, 'datasetId');

      const [run] = await db
        .select()
        .from(statisticalRuns)
        .where(
          and(
            eq(statisticalRuns.datasetId, datasetId),
            eq(statisticalRuns.organizationId, orgId),
          ),
        )
        .orderBy(desc(statisticalRuns.id))
        .limit(1);

      if (!run) {
        throw new AppError(404, 'STATS_NOT_FOUND', 'Statistical run not yet computed for dataset.');
      }

      const summary = JSON.parse(run.summaryMetricsJson) as {
        global: Record<string, unknown>;
        locations: Array<{ locationName: string }>;
      };

      const allowed = req.org!.assignedLocations;
      const locations =
        allowed.length > 0
          ? summary.locations.filter((l) => allowed.includes(l.locationName))
          : summary.locations;

      res.json({
        statisticalRunId: run.id,
        aqiStandard: run.aqiStandard,
        computedAt: run.computedAt,
        globalSummary: summary.global,
        locationSummaries: locations,
        trendAnalysis: JSON.parse(run.trendAnalysisJson),
        dataQualityReport: JSON.parse(run.dataQualityReportJson),
      });
    } catch (err) {
      next(err);
    }
  },
);

datasetRoutes.get(
  '/:id/hotspots',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const orgId = req.org!.organizationId;
      const datasetId = parsePositiveId(req.params.id, 'datasetId');

      const [latestRun] = await db
        .select({ id: statisticalRuns.id })
        .from(statisticalRuns)
        .where(
          and(
            eq(statisticalRuns.datasetId, datasetId),
            eq(statisticalRuns.organizationId, orgId),
          ),
        )
        .orderBy(desc(statisticalRuns.id))
        .limit(1);

      if (!latestRun) {
        res.json({ hotspots: [] });
        return;
      }

      const allowed = req.org!.assignedLocations;
      const rows = await db
        .select()
        .from(hotspots)
        .where(
          allowed.length > 0
            ? and(
                eq(hotspots.statisticalRunId, latestRun.id),
                inArray(hotspots.locationName, allowed),
              )
            : eq(hotspots.statisticalRunId, latestRun.id),
        );

      res.json({
        hotspots: rows.map((h) => ({
          id: h.id,
          statisticalRunId: h.statisticalRunId,
          locationName: h.locationName,
          latitude: h.latitude,
          longitude: h.longitude,
          severity: h.severity,
          compositeScore: h.compositeScore,
          dominantPollutant: h.dominantPollutant,
          exceedanceFrequencyPct: h.exceedanceFrequencyPct,
          peakValue: h.peakValue,
          meanValue: h.meanValue,
          evidenceRefs: JSON.parse(h.evidenceRefsJson),
          methodologyVersion: h.methodologyVersion,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

datasetRoutes.get(
  '/:id/readings',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const orgId = req.org!.organizationId;
      const datasetId = parsePositiveId(req.params.id, 'datasetId');
      const qcFilter = typeof req.query.qcFlag === 'string' ? req.query.qcFlag : undefined;
      const pollutantFilter =
        typeof req.query.pollutant === 'string' ? req.query.pollutant : undefined;
      const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
      const offset = Math.max(0, Number(req.query.offset || 0) || 0);

      const conditions = [
        eq(normalizedReadings.datasetId, datasetId),
        eq(normalizedReadings.organizationId, orgId),
      ];
      if (qcFilter && qcFilter !== 'all') {
        conditions.push(eq(normalizedReadings.qcFlag, qcFilter));
      }
      if (pollutantFilter && pollutantFilter !== 'all') {
        conditions.push(eq(normalizedReadings.pollutant, pollutantFilter));
      }
      if (req.org!.assignedLocations.length > 0) {
        conditions.push(inArray(normalizedReadings.locationName, req.org!.assignedLocations));
      }

      const [countRow, rows] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(normalizedReadings)
          .where(and(...conditions))
          .limit(1)
          .then((r) => r[0]),
        db
          .select()
          .from(normalizedReadings)
          .where(and(...conditions))
          .limit(limit)
          .offset(offset),
      ]);

      const total = Number(countRow?.count ?? 0);

      res.json({
        readings: rows.map((r) => ({
          ...r,
          transformationLog: JSON.parse(r.transformationLogJson || '[]'),
        })),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    } catch (err) {
      next(err);
    }
  },
);

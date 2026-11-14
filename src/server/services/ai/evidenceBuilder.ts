import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../../db/index.ts';
import {
  datasets,
  hotspots,
  normalizedReadings,
  statisticalRuns,
} from '../../../db/schema.ts';
import { AppError } from '../../middleware/errorHandler.ts';
import { DataQualityReport, LocationStatSummary, PollutantStatSummary } from './types.ts';

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /disregard\s+(the\s+)?system/gi,
  /you\s+are\s+now/gi,
  /<\s*\/?\s*(system|assistant|user|prompt)[^>]*>/gi,
];

export function sanitizeUntrustedText(raw: string | null | undefined, maxLen = 100): string {
  if (!raw) return '';
  let cleaned = String(raw).replace(/[\u0000-\u001F\u007F]/g, ' ');
  for (const pat of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pat, '[redacted]');
  }
  return cleaned.trim().slice(0, maxLen);
}

export interface EvidencePacket {
  dataset: {
    id: number;
    title: string;
    sourceType: string;
    rowCount: number;
    timeRangeStart: string | null;
    timeRangeEnd: string | null;
  };
  statisticalRunId: number;
  aqiStandard: string;
  globalSummary: Record<string, PollutantStatSummary>;
  locationSummaries: LocationStatSummary[];
  dataQualityReport: DataQualityReport;
  hotspots: Array<{
    locationName: string;
    severity: string;
    compositeScore: number;
    dominantPollutant: string;
    exceedanceFrequencyPct: number;
    meanValue: number;
    peakValue: number;
    sampleReadingIds: number[];
  }>;
  representativeHighReadings: Array<{
    readingId: number;
    locationName: string;
    recordedAt: string | null;
    pollutant: string;
    value: number;
    unit: string;
  }>;
  validLocations: string[];
}

export async function buildEvidencePacket(
  organizationId: number,
  datasetId: number,
  assignedLocations: string[],
): Promise<EvidencePacket> {
  const [ds] = await db
    .select()
    .from(datasets)
    .where(and(eq(datasets.id, datasetId), eq(datasets.organizationId, organizationId)))
    .limit(1);

  if (!ds) {
    throw new AppError(404, 'DATASET_NOT_FOUND', 'Dataset not found.');
  }
  if (ds.status !== 'ready') {
    throw new AppError(
      400,
      'DATASET_NOT_NORMALIZED',
      'Dataset must have confirmed mapping and completed normalization before AI briefing generation.',
    );
  }

  const [run] = await db
    .select()
    .from(statisticalRuns)
    .where(
      and(
        eq(statisticalRuns.datasetId, datasetId),
        eq(statisticalRuns.organizationId, organizationId),
      ),
    )
    .orderBy(desc(statisticalRuns.id))
    .limit(1);

  if (!run) {
    throw new AppError(404, 'STATS_NOT_FOUND', 'Statistical run not found for dataset.');
  }

  const summary = JSON.parse(run.summaryMetricsJson) as {
    global: Record<string, PollutantStatSummary>;
    locations: LocationStatSummary[];
  };
  const dataQualityReport = JSON.parse(run.dataQualityReportJson) as DataQualityReport;

  const filteredLocations =
    assignedLocations.length > 0
      ? summary.locations.filter((l) => assignedLocations.includes(l.locationName))
      : summary.locations;

  const hotspotRows = await db
    .select()
    .from(hotspots)
    .where(and(eq(hotspots.statisticalRunId, run.id), eq(hotspots.organizationId, organizationId)));

  const filteredHotspots = (
    assignedLocations.length > 0
      ? hotspotRows.filter((h) => assignedLocations.includes(h.locationName))
      : hotspotRows
  ).map((h) => {
    const refs = JSON.parse(h.evidenceRefsJson) as Array<{ readingIds?: number[] }>;
    const sampleIds = refs.flatMap((r) => r.readingIds || []).slice(0, 5);
    return {
      locationName: sanitizeUntrustedText(h.locationName, 80),
      severity: h.severity,
      compositeScore: h.compositeScore,
      dominantPollutant: h.dominantPollutant,
      exceedanceFrequencyPct: h.exceedanceFrequencyPct,
      meanValue: h.meanValue,
      peakValue: h.peakValue,
      sampleReadingIds: sampleIds,
    };
  });

  const validReadings = await db
    .select({
      id: normalizedReadings.id,
      locationName: normalizedReadings.locationName,
      recordedAt: normalizedReadings.recordedAt,
      pollutant: normalizedReadings.pollutant,
      normalizedValue: normalizedReadings.normalizedValue,
      canonicalUnit: normalizedReadings.canonicalUnit,
    })
    .from(normalizedReadings)
    .where(
      and(
        eq(normalizedReadings.organizationId, organizationId),
        eq(normalizedReadings.datasetId, datasetId),
        eq(normalizedReadings.qcFlag, 'valid'),
      ),
    )
    .limit(200);

  const representativeHighReadings = validReadings
    .filter((r) => r.normalizedValue !== null)
    .filter((r) => assignedLocations.length === 0 || assignedLocations.includes(r.locationName))
    .sort((a, b) => (b.normalizedValue ?? 0) - (a.normalizedValue ?? 0))
    .slice(0, 10)
    .map((r) => ({
      readingId: r.id,
      locationName: sanitizeUntrustedText(r.locationName, 80),
      recordedAt: r.recordedAt,
      pollutant: r.pollutant,
      value: r.normalizedValue!,
      unit: r.canonicalUnit,
    }));

  return {
    dataset: {
      id: ds.id,
      title: sanitizeUntrustedText(ds.title, 120),
      sourceType: ds.sourceType,
      rowCount: ds.rowCount,
      timeRangeStart: ds.timeRangeStart,
      timeRangeEnd: ds.timeRangeEnd,
    },
    statisticalRunId: run.id,
    aqiStandard: run.aqiStandard,
    globalSummary: summary.global,
    locationSummaries: filteredLocations.map((l) => ({
      ...l,
      locationName: sanitizeUntrustedText(l.locationName, 80),
    })),
    dataQualityReport,
    hotspots: filteredHotspots,
    representativeHighReadings,
    validLocations: filteredLocations.map((l) => sanitizeUntrustedText(l.locationName, 80)),
  };
}

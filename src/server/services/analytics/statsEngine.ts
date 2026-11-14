import { eq } from 'drizzle-orm';
import { db } from '../../../db/index.ts';
import { hotspots, normalizedReadings, statisticalRuns } from '../../../db/schema.ts';
import { STANDARD_THRESHOLDS } from '../../../shared/standards/aqiStandards.ts';
import { AqiStandard, EvidenceRef, HotspotSeverity, Pollutant } from '../../../shared/types.ts';

export interface PollutantSummaryStat {
  pollutant: Pollutant;
  unit: string;
  totalCount: number;
  validCount: number;
  missingCount: number;
  missingPct: number;
  invalidCount: number;
  duplicateCount: number;
  outlierCount: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  p95: number | null;
  stdDev: number | null;
  guidelineLimit: number;
  exceedanceCount: number;
  exceedancePct: number;
  trend: 'increasing' | 'decreasing' | 'stable' | 'insufficient_data';
  trendSlopePerDay: number | null;
}

export interface LocationStatSummary {
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  pollutants: Record<string, PollutantSummaryStat>;
}

export interface DataQualityReport {
  totalReadingSlots: number;
  validCount: number;
  completenessPct: number;
  missingCount: number;
  duplicateSuppressedCount: number;
  invalidFormatCount: number;
  negativeRejectedCount: number;
  suspectOutlierCount: number;
  unparseableTimestampCount: number;
  warnings: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeStatsForBucket(
  rows: Array<typeof normalizedReadings.$inferSelect>,
  pollutant: Pollutant,
  standard: AqiStandard,
): PollutantSummaryStat {
  const threshold = STANDARD_THRESHOLDS[standard][pollutant];
  const validRows = rows.filter((r) => r.qcFlag === 'valid' && r.normalizedValue !== null);
  const values = validRows.map((r) => r.normalizedValue!).sort((a, b) => a - b);

  const totalCount = rows.length;
  const validCount = validRows.length;
  const missingCount = rows.filter((r) => r.qcFlag === 'missing').length;
  const duplicateCount = rows.filter((r) => r.qcFlag === 'duplicate_suppressed').length;
  const outlierCount = rows.filter((r) => r.qcFlag === 'suspect_outlier').length;
  const invalidCount = rows.filter(
    (r) =>
      r.qcFlag === 'invalid_format' ||
      r.qcFlag === 'negative_rejected' ||
      r.qcFlag === 'unparseable_timestamp',
  ).length;

  const missingPct = totalCount > 0 ? Number(((missingCount / totalCount) * 100).toFixed(1)) : 0;

  if (values.length === 0) {
    return {
      pollutant,
      unit: threshold.canonicalUnit,
      totalCount,
      validCount: 0,
      missingCount,
      missingPct,
      invalidCount,
      duplicateCount,
      outlierCount,
      min: null,
      max: null,
      mean: null,
      median: null,
      p95: null,
      stdDev: null,
      guidelineLimit: threshold.guidelineLimit,
      exceedanceCount: 0,
      exceedancePct: 0,
      trend: 'insufficient_data',
      trendSlopePerDay: null,
    };
  }

  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  const variance =
    values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const exceedanceCount = values.filter((v) => v > threshold.guidelineLimit).length;
  const exceedancePct = Number(((exceedanceCount / values.length) * 100).toFixed(1));

  // Trend analysis requires >= 5 valid timestamped readings and >= 50% valid coverage
  let trend: PollutantSummaryStat['trend'] = 'insufficient_data';
  let trendSlopePerDay: number | null = null;
  const timestamped = validRows
    .filter((r) => r.recordedAt !== null)
    .map((r) => ({ t: Date.parse(r.recordedAt!), y: r.normalizedValue! }))
    .filter((pt) => !Number.isNaN(pt.t))
    .sort((a, b) => a.t - b.t);

  const coverage = totalCount > 0 ? validCount / totalCount : 0;
  if (timestamped.length >= 5 && coverage >= 0.5) {
    const t0 = timestamped[0].t;
    const points = timestamped.map((pt) => ({
      x: (pt.t - t0) / (1000 * 60 * 60 * 24),
      y: pt.y,
    }));
    const spanDays = points[points.length - 1].x;
    if (spanDays > 0.01) {
      const xMean = points.reduce((s, p) => s + p.x, 0) / points.length;
      const yMean = points.reduce((s, p) => s + p.y, 0) / points.length;
      const num = points.reduce((s, p) => s + (p.x - xMean) * (p.y - yMean), 0);
      const den = points.reduce((s, p) => s + Math.pow(p.x - xMean, 2), 0);
      if (den > 0) {
        const slope = num / den;
        trendSlopePerDay = Number(slope.toFixed(3));
        const relativeChange = (slope * spanDays) / Math.max(mean, 1);
        if (relativeChange > 0.08) trend = 'increasing';
        else if (relativeChange < -0.08) trend = 'decreasing';
        else trend = 'stable';
      }
    }
  }

  return {
    pollutant,
    unit: threshold.canonicalUnit,
    totalCount,
    validCount,
    missingCount,
    missingPct,
    invalidCount,
    duplicateCount,
    outlierCount,
    min: Number(values[0].toFixed(2)),
    max: Number(values[values.length - 1].toFixed(2)),
    mean: Number(mean.toFixed(2)),
    median: Number(percentile(values, 0.5).toFixed(2)),
    p95: Number(percentile(values, 0.95).toFixed(2)),
    stdDev: Number(stdDev.toFixed(2)),
    guidelineLimit: threshold.guidelineLimit,
    exceedanceCount,
    exceedancePct,
    trend,
    trendSlopePerDay,
  };
}

export async function runDeterministicAnalytics(params: {
  organizationId: number;
  datasetId: number;
  aqiStandard: AqiStandard;
}): Promise<{
  statisticalRunId: number;
  globalSummary: Record<string, PollutantSummaryStat>;
  locationSummaries: LocationStatSummary[];
  dataQualityReport: DataQualityReport;
  hotspotCount: number;
}> {
  const { organizationId, datasetId, aqiStandard } = params;

  const readings = await db
    .select()
    .from(normalizedReadings)
    .where(eq(normalizedReadings.datasetId, datasetId));

  // Global quality report
  const totalReadingSlots = readings.length;
  const validCount = readings.filter((r) => r.qcFlag === 'valid').length;
  const missingCount = readings.filter((r) => r.qcFlag === 'missing').length;
  const duplicateSuppressedCount = readings.filter(
    (r) => r.qcFlag === 'duplicate_suppressed',
  ).length;
  const invalidFormatCount = readings.filter((r) => r.qcFlag === 'invalid_format').length;
  const negativeRejectedCount = readings.filter((r) => r.qcFlag === 'negative_rejected').length;
  const suspectOutlierCount = readings.filter((r) => r.qcFlag === 'suspect_outlier').length;
  const unparseableTimestampCount = readings.filter(
    (r) => r.qcFlag === 'unparseable_timestamp',
  ).length;

  const completenessPct =
    totalReadingSlots > 0 ? Number(((validCount / totalReadingSlots) * 100).toFixed(1)) : 0;

  const qualityWarnings: string[] = [];
  if (completenessPct < 75) {
    qualityWarnings.push(
      `Dataset completeness is ${completenessPct}% (${missingCount} missing, ${invalidFormatCount + negativeRejectedCount} invalid).`,
    );
  }
  if (duplicateSuppressedCount > 0) {
    qualityWarnings.push(
      `${duplicateSuppressedCount} duplicate location/timestamp/pollutant reading(s) suppressed from averages.`,
    );
  }
  if (suspectOutlierCount > 0) {
    qualityWarnings.push(
      `${suspectOutlierCount} extreme reading(s) exceeded physical ceilings and were isolated from averages.`,
    );
  }
  if (unparseableTimestampCount > 0) {
    qualityWarnings.push(
      `${unparseableTimestampCount} reading(s) had unparseable timestamps and were excluded from trend analysis.`,
    );
  }

  const dataQualityReport: DataQualityReport = {
    totalReadingSlots,
    validCount,
    completenessPct,
    missingCount,
    duplicateSuppressedCount,
    invalidFormatCount,
    negativeRejectedCount,
    suspectOutlierCount,
    unparseableTimestampCount,
    warnings: qualityWarnings,
  };

  // Group by pollutant globally
  const byPollutant = new Map<Pollutant, Array<typeof normalizedReadings.$inferSelect>>();
  for (const r of readings) {
    const p = r.pollutant as Pollutant;
    if (!byPollutant.has(p)) byPollutant.set(p, []);
    byPollutant.get(p)!.push(r);
  }

  const globalSummary: Record<string, PollutantSummaryStat> = {};
  for (const [pollutant, list] of byPollutant.entries()) {
    globalSummary[pollutant] = computeStatsForBucket(list, pollutant, aqiStandard);
  }

  // Group by location
  const byLocation = new Map<string, Array<typeof normalizedReadings.$inferSelect>>();
  for (const r of readings) {
    if (!byLocation.has(r.locationName)) byLocation.set(r.locationName, []);
    byLocation.get(r.locationName)!.push(r);
  }

  const locationSummaries: LocationStatSummary[] = [];
  const computedHotspots: Array<typeof hotspots.$inferInsert> = [];

  for (const [locationName, locRows] of byLocation.entries()) {
    const coordRow = locRows.find((r) => r.latitude !== null && r.longitude !== null);
    const latitude = coordRow?.latitude ?? null;
    const longitude = coordRow?.longitude ?? null;

    const locByPollutant = new Map<Pollutant, Array<typeof normalizedReadings.$inferSelect>>();
    for (const r of locRows) {
      const p = r.pollutant as Pollutant;
      if (!locByPollutant.has(p)) locByPollutant.set(p, []);
      locByPollutant.get(p)!.push(r);
    }

    const pollutantsObj: Record<string, PollutantSummaryStat> = {};
    let highestComposite = -1;
    let dominantPollutant: Pollutant = 'PM25';
    let dominantStat: PollutantSummaryStat | null = null;

    for (const [pollutant, pRows] of locByPollutant.entries()) {
      const stat = computeStatsForBucket(pRows, pollutant, aqiStandard);
      pollutantsObj[pollutant] = stat;

      if (stat.validCount > 0 && stat.p95 !== null && stat.mean !== null) {
        const p95Score = Math.min(100, (stat.p95 / (stat.guidelineLimit * 2.5)) * 100);
        const excScore = stat.exceedancePct;
        const meanScore = Math.min(100, (stat.mean / (stat.guidelineLimit * 2.0)) * 100);
        const trendScore = stat.trend === 'increasing' ? 100 : stat.trend === 'stable' ? 25 : 0;
        const composite = 0.4 * p95Score + 0.35 * excScore + 0.15 * meanScore + 0.1 * trendScore;

        if (composite > highestComposite) {
          highestComposite = composite;
          dominantPollutant = pollutant;
          dominantStat = stat;
        }
      }
    }

    locationSummaries.push({
      locationName,
      latitude,
      longitude,
      pollutants: pollutantsObj,
    });

    if (dominantStat && dominantStat.validCount > 0 && dominantStat.mean !== null && dominantStat.p95 !== null) {
      const completenessRatio =
        dominantStat.totalCount > 0 ? dominantStat.validCount / dominantStat.totalCount : 0;
      const compositeScore = Number(Math.max(0, Math.min(100, highestComposite)).toFixed(1));

      let severity: HotspotSeverity = 'watch';
      if (completenessRatio < 0.3) {
        severity = 'watch';
      } else if (compositeScore >= 75 || dominantStat.exceedancePct >= 75) {
        severity = 'critical';
      } else if (compositeScore >= 50 || dominantStat.exceedancePct >= 45) {
        severity = 'high';
      } else if (compositeScore >= 25 || dominantStat.exceedancePct >= 15) {
        severity = 'moderate';
      }

      // Capture top 5 highest reading IDs for full provenance
      const topReadings = locRows
        .filter(
          (r) =>
            r.pollutant === dominantPollutant &&
            r.qcFlag === 'valid' &&
            r.normalizedValue !== null,
        )
        .sort((a, b) => (b.normalizedValue ?? 0) - (a.normalizedValue ?? 0))
        .slice(0, 5);

      const evidenceRefs: EvidenceRef[] = topReadings.map((r) => ({
        datasetId,
        locationName,
        pollutant: dominantPollutant,
        timeWindow: r.recordedAt || 'timestamp unavailable',
        readingIds: [r.id],
        observedValue: r.normalizedValue,
        unit: r.canonicalUnit,
        note:
          completenessRatio < 0.3
            ? 'Low completeness (<30%); downgraded to watch status.'
            : undefined,
      }));

      computedHotspots.push({
        organizationId,
        statisticalRunId: 0, // populated inside transaction
        locationName,
        latitude,
        longitude,
        severity,
        compositeScore,
        dominantPollutant,
        exceedanceFrequencyPct: dominantStat.exceedancePct,
        peakValue: dominantStat.max ?? 0,
        meanValue: dominantStat.mean,
        evidenceRefsJson: JSON.stringify(evidenceRefs),
        methodologyVersion: 'v1.0',
      });
    }
  }

  // Sort hotspots descending by composite score
  computedHotspots.sort((a, b) => b.compositeScore - a.compositeScore);

  const runId = db.transaction((tx) => {
    const run = tx
      .insert(statisticalRuns)
      .values({
        organizationId,
        datasetId,
        aqiStandard,
        summaryMetricsJson: JSON.stringify({
          global: globalSummary,
          locations: locationSummaries,
        }),
        trendAnalysisJson: JSON.stringify(
          Object.fromEntries(
            Object.entries(globalSummary).map(([k, v]) => [
              k,
              { trend: v.trend, slopePerDay: v.trendSlopePerDay },
            ]),
          ),
        ),
        dataQualityReportJson: JSON.stringify(dataQualityReport),
      })
      .returning({ id: statisticalRuns.id })
      .get();

    if (computedHotspots.length > 0) {
      tx.insert(hotspots)
        .values(
          computedHotspots.map((h) => ({
            ...h,
            statisticalRunId: run.id,
          })),
        )
        .run();
    }

    return run.id;
  });

  return {
    statisticalRunId: runId,
    globalSummary,
    locationSummaries,
    dataQualityReport,
    hotspotCount: computedHotspots.length,
  };
}

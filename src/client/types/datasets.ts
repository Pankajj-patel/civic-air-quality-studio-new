import { EvidenceRef, HotspotSeverity, Pollutant } from '../../shared/types.ts';

export interface DatasetSummaryRecord {
  id: number;
  organizationId: number;
  title: string;
  sourceType: 'csv' | 'xlsx' | 'paste' | 'manual' | 'api';
  originalFilename: string | null;
  rowCount: number;
  status: 'pending_mapping' | 'normalizing' | 'ready' | 'failed';
  timeRangeStart: string | null;
  timeRangeEnd: string | null;
  createdAt: string;
}

export interface ServerColumnDetection {
  header: string;
  suggestedRole: 'location' | 'timestamp' | 'time' | 'latitude' | 'longitude' | 'pollutant' | 'ignore';
  suggestedPollutant?: Pollutant;
  suggestedUnit: string;
  sampleValues: string[];
  missingCount: number;
}

export interface DatasetPreviewResponse {
  dataset: DatasetSummaryRecord;
  detectedSchema: {
    headers: string[];
    detectedColumns: ServerColumnDetection[];
    warnings: string[];
    dateFormatHint: 'auto' | 'DMY' | 'MDY' | 'ISO';
  };
  confirmedMapping: unknown;
  previewRows: Record<string, string>[];
}

export interface PollutantStat {
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

export interface DatasetStatsResponse {
  statisticalRunId: number;
  aqiStandard: string;
  computedAt: string;
  globalSummary: Record<string, PollutantStat>;
  locationSummaries: Array<{
    locationName: string;
    latitude: number | null;
    longitude: number | null;
    pollutants: Record<string, PollutantStat>;
  }>;
  dataQualityReport: {
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
  };
}

export interface HotspotRecord {
  id: number;
  statisticalRunId: number;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  severity: HotspotSeverity;
  compositeScore: number;
  dominantPollutant: string;
  exceedanceFrequencyPct: number;
  peakValue: number;
  meanValue: number;
  evidenceRefs: EvidenceRef[];
  methodologyVersion: string;
}

export interface NormalizedReadingRow {
  id: number;
  locationName: string;
  recordedAt: string | null;
  pollutant: string;
  originalValue: string | null;
  originalUnit: string | null;
  normalizedValue: number | null;
  canonicalUnit: string;
  qcFlag: string;
  transformationLog: string[];
}

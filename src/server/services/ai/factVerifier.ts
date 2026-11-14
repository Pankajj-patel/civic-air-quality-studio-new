import { EvidenceRef, FindingCategory, StakeholderType } from '../../../shared/types.ts';
import { EvidencePacket } from './evidenceBuilder.ts';

export interface GeneratedFinding {
  id: string;
  category: FindingCategory;
  title: string;
  narrative: string;
  confidence: 'high' | 'medium' | 'low';
  evidenceRefs: EvidenceRef[];
}

export interface GeneratedRecommendation {
  title: string;
  rationale: string;
  impactScore: number;
  urgency: 'immediate' | 'short_term' | 'medium_term';
  feasibility: 'high' | 'medium' | 'low';
  responsibleUnit: string;
  suggestedTimeline: string;
  evidenceRefs: EvidenceRef[];
}

export interface GeneratedBriefingPayload {
  title: string;
  executiveSummary: string;
  findings: GeneratedFinding[];
  dataQualityNotes: string[];
  risksAndUncertainties: string[];
  recommendations: GeneratedRecommendation[];
}

export interface VerificationResult {
  passed: boolean;
  mismatchesFound: string[];
}

const OUT_OF_AUTHORITY_PATTERNS: Record<StakeholderType, RegExp[]> = {
  municipal_ward_officer: [],
  housing_society: [
    /\bfine\s+highway\b/i,
    /\bre-route\s+city\s+bus/i,
    /\bseal\s+industrial\s+plant/i,
  ],
  school: [
    /\brepave\s+(public\s+)?road/i,
    /\bissue\s+municipal\s+fine/i,
    /\benforce\s+construction\s+ban\s+across\s+ward/i,
  ],
};

function collectVerifiedNumbers(packet: EvidencePacket): number[] {
  const nums = new Set<number>();
  nums.add(packet.dataset.id);
  nums.add(packet.dataset.rowCount);
  nums.add(packet.dataQualityReport.completenessPct);
  nums.add(packet.dataQualityReport.validCount);
  nums.add(packet.dataQualityReport.missingCount);
  nums.add(packet.dataQualityReport.totalReadingSlots);
  nums.add(packet.dataQualityReport.duplicateSuppressedCount);
  nums.add(packet.dataQualityReport.suspectOutlierCount);

  const addStat = (s: {
    min: number | null;
    max: number | null;
    mean: number | null;
    median: number | null;
    p95: number | null;
    stdDev: number | null;
    guidelineLimit: number;
    exceedanceCount: number;
    exceedancePct: number;
    validCount: number;
    missingCount: number;
    missingPct: number;
  }) => {
    for (const v of [
      s.min,
      s.max,
      s.mean,
      s.median,
      s.p95,
      s.stdDev,
      s.guidelineLimit,
      s.exceedanceCount,
      s.exceedancePct,
      s.validCount,
      s.missingCount,
      s.missingPct,
    ]) {
      if (v !== null && Number.isFinite(v)) nums.add(v);
    }
  };

  for (const st of Object.values(packet.globalSummary)) addStat(st);
  for (const loc of packet.locationSummaries) {
    for (const st of Object.values(loc.pollutants)) addStat(st);
  }
  for (const h of packet.hotspots) {
    nums.add(h.compositeScore);
    nums.add(h.exceedanceFrequencyPct);
    nums.add(h.meanValue);
    nums.add(h.peakValue);
  }
  for (const r of packet.representativeHighReadings) {
    nums.add(r.readingId);
    nums.add(r.value);
  }

  return Array.from(nums);
}

function isNearVerifiedNumber(val: number, verified: number[]): boolean {
  return verified.some((v) => Math.abs(v - val) <= Math.max(0.5, Math.abs(v) * 0.02));
}

export function verifyGeneratedBriefing(
  payload: GeneratedBriefingPayload,
  packet: EvidencePacket,
  stakeholderType: StakeholderType,
): VerificationResult {
  const mismatches: string[] = [];
  const verifiedNums = collectVerifiedNumbers(packet);
  const validLocationSet = new Set(packet.validLocations.map((l) => l.toLowerCase()));

  for (const finding of payload.findings) {
    if (!finding.evidenceRefs || finding.evidenceRefs.length === 0) {
      mismatches.push(`Finding "${finding.title}" lacks evidenceRefs.`);
      continue;
    }

    for (const ref of finding.evidenceRefs) {
      const locLower = (ref.locationName || '').toLowerCase();
      if (
        locLower &&
        locLower !== 'all locations' &&
        locLower !== 'organization-wide' &&
        !validLocationSet.has(locLower)
      ) {
        mismatches.push(`Unrecognized location referenced: "${ref.locationName}".`);
      }

      if (
        ref.observedValue !== null &&
        ref.observedValue !== undefined &&
        !isNearVerifiedNumber(ref.observedValue, verifiedNums)
      ) {
        mismatches.push(
          `Cited observedValue ${ref.observedValue} in "${finding.title}" does not match backend statistics.`,
        );
      }
    }
  }

  for (const rec of payload.recommendations) {
    for (const pat of OUT_OF_AUTHORITY_PATTERNS[stakeholderType]) {
      if (pat.test(rec.title) || pat.test(rec.rationale)) {
        mismatches.push(
          `Recommendation "${rec.title}" appears outside ${stakeholderType} authority.`,
        );
      }
    }
  }

  return {
    passed: mismatches.length === 0,
    mismatchesFound: mismatches,
  };
}

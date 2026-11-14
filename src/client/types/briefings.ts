import {
  BriefingStatus,
  EvidenceRef,
  FindingCategory,
  ReadingLevel,
  RecommendationStatus,
  StakeholderType,
  SupportedLanguage,
} from '../../shared/types.ts';

export interface StructuredFindingRecord {
  id: string;
  category: FindingCategory;
  title: string;
  narrative: string;
  confidence: 'high' | 'medium' | 'low';
  evidenceRefs: EvidenceRef[];
}

export interface RecommendationRecord {
  id: number;
  briefingId: number;
  stakeholderType: StakeholderType;
  title: string;
  rationale: string;
  evidenceRefs: EvidenceRef[];
  impactScore: number;
  urgency: 'immediate' | 'short_term' | 'medium_term';
  feasibility: 'high' | 'medium' | 'low';
  responsibleUnit: string;
  suggestedTimeline: string;
  status: RecommendationStatus;
}

export interface CitizenAdvisoryRecord {
  id: number;
  briefingId: number;
  readingLevel: ReadingLevel;
  language: SupportedLanguage;
  headline: string;
  currentConditionSummary: string;
  healthGuidance: string;
  childrenGuidance: string;
  olderAdultsGuidance: string;
  sensitiveGroupsGuidance: string;
  outdoorActivityGuidance: string;
  safetyCheckPassed: boolean;
  createdAt: string;
}

export interface BriefingSummaryItem {
  id: number;
  datasetId: number;
  stakeholderType: StakeholderType;
  title: string;
  executiveSummary: string;
  status: BriefingStatus;
  aiMetadata: {
    provider: string;
    model: string;
    verificationPassed: boolean;
    mismatchesFound: string[];
    tokenUsage?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    } | null;
    latencyMs?: number;
    generatedAt: string;
  };
  createdAt: string;
}

export interface FullBriefingRecord extends BriefingSummaryItem {
  datasetTitle: string;
  statisticalRunId: number;
  structuredFindings: StructuredFindingRecord[];
  dataQualityNotes: string[];
  risksAndUncertainties: string[];
  recommendations: RecommendationRecord[];
  advisories: CitizenAdvisoryRecord[];
}

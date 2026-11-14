export const ORG_TYPES = ['municipality', 'housing_society', 'school', 'ngo'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const AQI_STANDARDS = ['CPCB_NAQI', 'US_EPA', 'WHO_2021'] as const;
export type AqiStandard = (typeof AQI_STANDARDS)[number];

export const USER_ROLES = [
  'org_admin',
  'ward_officer',
  'housing_manager',
  'school_admin',
  'analyst',
  'viewer',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const STAKEHOLDER_TYPES = [
  'municipal_ward_officer',
  'housing_society',
  'school',
] as const;
export type StakeholderType = (typeof STAKEHOLDER_TYPES)[number];

export const POLLUTANTS = ['PM25', 'PM10', 'NO2', 'SO2', 'CO', 'O3', 'AQI'] as const;
export type Pollutant = (typeof POLLUTANTS)[number];

export const QC_FLAGS = [
  'valid',
  'missing',
  'invalid_format',
  'negative_rejected',
  'suspect_outlier',
  'duplicate_suppressed',
  'unparseable_timestamp',
] as const;
export type QcFlag = (typeof QC_FLAGS)[number];

export const FINDING_CATEGORIES = [
  'verified_observation',
  'calculated_statistic',
  'ai_interpretation',
  'hypothesis_for_investigation',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const HOTSPOT_SEVERITIES = ['critical', 'high', 'moderate', 'watch'] as const;
export type HotspotSeverity = (typeof HOTSPOT_SEVERITIES)[number];

export const READING_LEVELS = ['simple', 'standard', 'detailed'] as const;
export type ReadingLevel = (typeof READING_LEVELS)[number];

export const SUPPORTED_LANGUAGES = ['en', 'hi'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DATASET_STATUSES = ['pending_mapping', 'normalizing', 'ready', 'failed'] as const;
export type DatasetStatus = (typeof DATASET_STATUSES)[number];

export const BRIEFING_STATUSES = ['draft', 'verified', 'published'] as const;
export type BriefingStatus = (typeof BRIEFING_STATUSES)[number];

export const RECOMMENDATION_STATUSES = ['proposed', 'in_progress', 'completed', 'dismissed'] as const;
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number];

export interface EvidenceRef {
  datasetId: number;
  locationName: string;
  pollutant?: Pollutant;
  timeWindow?: string;
  readingIds?: number[];
  observedValue?: number | null;
  unit?: string;
  note?: string;
}

export interface OrganizationMembershipSummary {
  organizationId: number;
  organizationName: string;
  slug: string;
  orgType: OrgType;
  defaultAqiStandard: AqiStandard;
  defaultLanguage: string;
  role: UserRole;
  assignedLocations: string[];
}

export interface AuthUserSummary {
  id: number;
  email: string;
  fullName: string;
  memberships: OrganizationMembershipSummary[];
}

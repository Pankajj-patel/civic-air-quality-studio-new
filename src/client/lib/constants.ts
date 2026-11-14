import {
  OrgType,
  ReadingLevel,
  StakeholderType,
  SupportedLanguage,
  UserRole,
} from '../../shared/types.ts';
import { apiRequest } from './api.ts';

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  municipality: 'Municipal Ward / Authority',
  housing_society: 'Housing Society',
  school: 'School / Campus',
  ngo: 'Community Organization',
};

export const UNIT_OPTIONS = ['µg/m³', 'mg/m³', 'ppb', 'ppm', 'index', 'unknown'] as const;

export const STAKEHOLDER_LABELS: Record<StakeholderType, string> = {
  municipal_ward_officer: 'Municipal Ward Officer',
  housing_society: 'Housing Society',
  school: 'School Administration',
};

export const STAKEHOLDER_AUTHORITY: Record<
  StakeholderType,
  { label: string; scopeSummary: string; allowedDomains: string[] }
> = {
  municipal_ward_officer: {
    label: 'Municipal Ward Officer',
    scopeSummary: 'Public road dust, C&D site compliance, waste burning, local traffic coordination.',
    allowedDomains: [
      'Road Dust Mitigation',
      'Construction Dust Inspection',
      'Waste Burning Prevention',
      'Traffic Management Coordination',
      'Public Ward Campaigns',
    ],
  },
  housing_society: {
    label: 'Housing Society',
    scopeSummary: 'Premises dust control, internal renovation rules, waste segregation, green cover.',
    allowedDomains: [
      'Premises Dust Control',
      'Internal Construction Management',
      'Waste Segregation & Disposal',
      'Green Space Maintenance',
      'Resident Awareness',
    ],
  },
  school: {
    label: 'School Administration',
    scopeSummary: 'Outdoor/PE scheduling, classroom ventilation, student protection, parent notices.',
    allowedDomains: [
      'Outdoor Activity Advisories',
      'PE Scheduling Adjustments',
      'Classroom Ventilation',
      'Parent & Teacher Communication',
      'Student Escalation Protocols',
    ],
  },
};

export const READING_LEVEL_LABELS: Record<ReadingLevel, string> = {
  simple: 'Simple (General Public)',
  standard: 'Standard (Community)',
  detailed: 'Detailed (Informed Readers)',
};

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  hi: 'Hindi (हिन्दी)',
};

const WRITE_ROLES = new Set<UserRole>([
  'org_admin',
  'ward_officer',
  'housing_manager',
  'school_admin',
  'analyst',
]);

const PUBLISH_ROLES = new Set<UserRole>([
  'org_admin',
  'ward_officer',
  'housing_manager',
  'school_admin',
]);

export function canWriteRole(role: UserRole | undefined | null): boolean {
  return Boolean(role && WRITE_ROLES.has(role));
}

export function canPublishRole(role: UserRole | undefined | null): boolean {
  return Boolean(role && PUBLISH_ROLES.has(role));
}

export interface BackgroundJobStatus {
  id: string;
  jobType: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progressPct: number;
  resultRef: Record<string, unknown> | null;
  errorMessage: string | null;
}

export async function pollBackgroundJob(
  jobId: string,
  options: {
    onProgress?: (job: BackgroundJobStatus) => void;
    intervalMs?: number;
    maxAttempts?: number;
    signal?: AbortSignal;
  } = {},
): Promise<BackgroundJobStatus> {
  const intervalMs = options.intervalMs ?? 800;
  const maxAttempts = options.maxAttempts ?? 120;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      throw new Error('Background job polling cancelled.');
    }
    const { job } = await apiRequest<{ job: BackgroundJobStatus }>(`/api/jobs/${jobId}`);
    options.onProgress?.(job);
    if (job.status === 'completed') {
      return job;
    }
    if (job.status === 'failed') {
      throw new Error(job.errorMessage || 'Background processing failed.');
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      options.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  throw new Error('Background job did not finish within the expected time window.');
}

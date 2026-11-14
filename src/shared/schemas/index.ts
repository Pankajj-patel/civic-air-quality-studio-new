import { z } from 'zod';
import {
  AQI_STANDARDS,
  ORG_TYPES,
  POLLUTANTS,
  READING_LEVELS,
  RECOMMENDATION_STATUSES,
  STAKEHOLDER_TYPES,
  SUPPORTED_LANGUAGES,
  USER_ROLES,
  BRIEFING_STATUSES,
} from '../types.ts';

export const registerSchema = z.object({
  email: z.string().trim().email().max(180),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters long.')
    .max(128)
    .regex(/[A-Z]/, 'Password must include at least one uppercase letter.')
    .regex(/[a-z]/, 'Password must include at least one lowercase letter.')
    .regex(/[0-9]/, 'Password must include at least one number.')
    .regex(/[^A-Za-z0-9]/, 'Password must include at least one special character.'),
  fullName: z.string().trim().min(2).max(120),
  organizationName: z.string().trim().min(2).max(160).optional(),
  orgType: z.enum(ORG_TYPES).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(160),
  orgType: z.enum(ORG_TYPES),
  defaultAqiStandard: z.enum(AQI_STANDARDS).default('CPCB_NAQI'),
  defaultLanguage: z.enum(SUPPORTED_LANGUAGES).default('en'),
});

export const updateOrgSettingsSchema = z.object({
  defaultAqiStandard: z.enum(AQI_STANDARDS).optional(),
  defaultLanguage: z.enum(SUPPORTED_LANGUAGES).optional(),
  name: z.string().trim().min(2).max(160).optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().trim().email(),
  fullName: z.string().trim().min(2).max(120).optional(),
  role: z.enum(USER_ROLES),
  assignedLocations: z.array(z.string().trim().min(1).max(120)).default([]),
});

export const pollutantColumnMappingSchema = z.object({
  sourceColumn: z.string().min(1),
  pollutant: z.enum(POLLUTANTS),
  sourceUnit: z.string().trim().max(40).default('unknown'),
});

export const confirmMappingSchema = z.object({
  locationColumn: z.string().min(1),
  timestampColumn: z.string().nullable(),
  timeColumn: z.string().nullable().optional(),
  dateFormatHint: z.enum(['auto', 'DMY', 'MDY', 'ISO']).default('auto'),
  latitudeColumn: z.string().nullable().optional(),
  longitudeColumn: z.string().nullable().optional(),
  pollutantColumns: z.array(pollutantColumnMappingSchema).min(1),
});

export const pasteOrManualUploadSchema = z.object({
  title: z.string().trim().min(2).max(180),
  sourceType: z.enum(['paste', 'manual']),
  rawText: z.string().min(1).max(2_000_000).optional(),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000).optional(),
});

export const generateBriefingSchema = z.object({
  datasetId: z.number().int().positive(),
  stakeholderType: z.enum(STAKEHOLDER_TYPES),
  title: z.string().trim().min(3).max(200).optional(),
  previousBriefingId: z.number().int().positive().nullable().optional(),
});

export const updateBriefingStatusSchema = z.object({
  status: z.enum(BRIEFING_STATUSES),
});

export const updateRecommendationStatusSchema = z.object({
  status: z.enum(RECOMMENDATION_STATUSES),
});

export const generateAdvisorySchema = z.object({
  readingLevel: z.enum(READING_LEVELS),
  languages: z.array(z.enum(SUPPORTED_LANGUAGES)).min(1).default(['en', 'hi']),
  forceRegenerate: z.boolean().optional(),
});

export const compareBriefingsSchema = z.object({
  currentBriefingId: z.number().int().positive(),
  previousBriefingId: z.number().int().positive(),
});

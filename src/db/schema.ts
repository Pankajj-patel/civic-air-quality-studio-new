import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const organizations = sqliteTable('organizations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  orgType: text('org_type').notNull(), // municipality | housing_society | school | ngo
  defaultAqiStandard: text('default_aqi_standard').notNull().default('CPCB_NAQI'),
  defaultLanguage: text('default_language').notNull().default('en'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const organizationMembers = sqliteTable(
  'organization_members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // org_admin | ward_officer | housing_manager | school_admin | analyst | viewer
    assignedLocationsJson: text('assigned_locations_json').notNull().default('[]'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('org_members_org_user_idx').on(table.organizationId, table.userId),
  ],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actorUserId: integer('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    metadataJson: text('metadata_json').notNull().default('{}'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('audit_logs_org_created_idx').on(table.organizationId, table.createdAt),
  ],
);

export const monitoringStations = sqliteTable(
  'monitoring_stations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code'),
    latitude: real('latitude'),
    longitude: real('longitude'),
    zoneType: text('zone_type').notNull().default('unknown'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('stations_org_name_idx').on(table.organizationId, table.name),
  ],
);

export const datasets = sqliteTable(
  'datasets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    uploadedBy: integer('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    sourceType: text('source_type').notNull(), // csv | xlsx | paste | manual | api
    originalFilename: text('original_filename'),
    fileHash: text('file_hash').notNull(),
    rowCount: integer('row_count').notNull().default(0),
    status: text('status').notNull().default('pending_mapping'),
    errorMessage: text('error_message'),
    timeRangeStart: text('time_range_start'),
    timeRangeEnd: text('time_range_end'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('datasets_org_created_idx').on(table.organizationId, table.createdAt),
  ],
);

export const datasetMappings = sqliteTable('dataset_mappings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  datasetId: integer('dataset_id')
    .notNull()
    .unique()
    .references(() => datasets.id, { onDelete: 'cascade' }),
  detectedSchemaJson: text('detected_schema_json').notNull(),
  confirmedMappingJson: text('confirmed_mapping_json'),
  approvedBy: integer('approved_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  approvedAt: text('approved_at'),
});

export const rawRecords = sqliteTable(
  'raw_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    datasetId: integer('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    rowIndex: integer('row_index').notNull(),
    rawPayloadJson: text('raw_payload_json').notNull(),
    parseWarningsJson: text('parse_warnings_json').notNull().default('[]'),
  },
  (table) => [
    index('raw_records_dataset_row_idx').on(table.datasetId, table.rowIndex),
  ],
);

export const normalizedReadings = sqliteTable(
  'normalized_readings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    datasetId: integer('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    rawRecordId: integer('raw_record_id')
      .notNull()
      .references(() => rawRecords.id, { onDelete: 'cascade' }),
    stationId: integer('station_id').references(() => monitoringStations.id, {
      onDelete: 'set null',
    }),
    locationName: text('location_name').notNull(),
    latitude: real('latitude'),
    longitude: real('longitude'),
    recordedAt: text('recorded_at'),
    pollutant: text('pollutant').notNull(),
    originalValue: text('original_value'),
    originalUnit: text('original_unit'),
    normalizedValue: real('normalized_value'),
    canonicalUnit: text('canonical_unit').notNull(),
    qcFlag: text('qc_flag').notNull(),
    transformationLogJson: text('transformation_log_json').notNull().default('[]'),
  },
  (table) => [
    index('norm_readings_query_idx').on(
      table.organizationId,
      table.datasetId,
      table.locationName,
      table.pollutant,
      table.recordedAt,
    ),
    index('norm_readings_qc_idx').on(
      table.organizationId,
      table.datasetId,
      table.qcFlag,
      table.pollutant,
    ),
  ],
);

export const statisticalRuns = sqliteTable(
  'statistical_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    datasetId: integer('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    aqiStandard: text('aqi_standard').notNull(),
    summaryMetricsJson: text('summary_metrics_json').notNull(),
    trendAnalysisJson: text('trend_analysis_json').notNull(),
    dataQualityReportJson: text('data_quality_report_json').notNull(),
    computedAt: text('computed_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('stat_runs_org_dataset_idx').on(table.organizationId, table.datasetId),
  ],
);

export const hotspots = sqliteTable(
  'hotspots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    statisticalRunId: integer('statistical_run_id')
      .notNull()
      .references(() => statisticalRuns.id, { onDelete: 'cascade' }),
    locationName: text('location_name').notNull(),
    latitude: real('latitude'),
    longitude: real('longitude'),
    severity: text('severity').notNull(),
    compositeScore: real('composite_score').notNull(),
    dominantPollutant: text('dominant_pollutant').notNull(),
    exceedanceFrequencyPct: real('exceedance_frequency_pct').notNull(),
    peakValue: real('peak_value').notNull(),
    meanValue: real('mean_value').notNull(),
    evidenceRefsJson: text('evidence_refs_json').notNull(),
    methodologyVersion: text('methodology_version').notNull().default('v1.0'),
  },
  (table) => [
    index('hotspots_run_org_idx').on(table.statisticalRunId, table.organizationId),
  ],
);

export const briefings = sqliteTable(
  'briefings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    datasetId: integer('dataset_id')
      .notNull()
      .references(() => datasets.id, { onDelete: 'cascade' }),
    statisticalRunId: integer('statistical_run_id')
      .notNull()
      .references(() => statisticalRuns.id, { onDelete: 'cascade' }),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    stakeholderType: text('stakeholder_type').notNull(),
    title: text('title').notNull(),
    executiveSummary: text('executive_summary').notNull(),
    structuredFindingsJson: text('structured_findings_json').notNull(),
    dataQualityNotesJson: text('data_quality_notes_json').notNull(),
    risksAndUncertaintiesJson: text('risks_and_uncertainties_json').notNull(),
    aiMetadataJson: text('ai_metadata_json').notNull(),
    status: text('status').notNull().default('draft'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('briefings_org_stakeholder_idx').on(
      table.organizationId,
      table.stakeholderType,
      table.createdAt,
    ),
  ],
);

export const briefingComparisons = sqliteTable(
  'briefing_comparisons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    currentBriefingId: integer('current_briefing_id')
      .notNull()
      .references(() => briefings.id, { onDelete: 'cascade' }),
    previousBriefingId: integer('previous_briefing_id')
      .notNull()
      .references(() => briefings.id, { onDelete: 'cascade' }),
    isComparable: integer('is_comparable', { mode: 'boolean' }).notNull(),
    incomparabilityReasonsJson: text('incomparability_reasons_json').notNull().default('[]'),
    deltaMetricsJson: text('delta_metrics_json').notNull(),
    summaryNarrative: text('summary_narrative').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('comparisons_org_created_idx').on(table.organizationId, table.createdAt),
  ],
);

export const recommendations = sqliteTable(
  'recommendations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    briefingId: integer('briefing_id')
      .notNull()
      .references(() => briefings.id, { onDelete: 'cascade' }),
    stakeholderType: text('stakeholder_type').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    evidenceRefsJson: text('evidence_refs_json').notNull(),
    impactScore: integer('impact_score').notNull(),
    urgency: text('urgency').notNull(),
    feasibility: text('feasibility').notNull(),
    responsibleUnit: text('responsible_unit').notNull(),
    suggestedTimeline: text('suggested_timeline').notNull(),
    status: text('status').notNull().default('proposed'),
  },
  (table) => [
    index('recommendations_briefing_org_idx').on(table.briefingId, table.organizationId),
  ],
);

export const citizenAdvisories = sqliteTable(
  'citizen_advisories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    briefingId: integer('briefing_id')
      .notNull()
      .references(() => briefings.id, { onDelete: 'cascade' }),
    readingLevel: text('reading_level').notNull(),
    language: text('language').notNull(),
    headline: text('headline').notNull(),
    currentConditionSummary: text('current_condition_summary').notNull(),
    healthGuidance: text('health_guidance').notNull(),
    childrenGuidance: text('children_guidance').notNull(),
    olderAdultsGuidance: text('older_adults_guidance').notNull(),
    sensitiveGroupsGuidance: text('sensitive_groups_guidance').notNull(),
    outdoorActivityGuidance: text('outdoor_activity_guidance').notNull(),
    safetyCheckPassed: integer('safety_check_passed', { mode: 'boolean' })
      .notNull()
      .default(true),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('advisories_briefing_level_lang_idx').on(
      table.briefingId,
      table.readingLevel,
      table.language,
    ),
  ],
);

export const backgroundJobs = sqliteTable(
  'background_jobs',
  {
    id: text('id').primaryKey(),
    organizationId: integer('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    jobType: text('job_type').notNull(),
    status: text('status').notNull().default('queued'),
    progressPct: integer('progress_pct').notNull().default(0),
    payloadJson: text('payload_json').notNull(),
    resultRefJson: text('result_ref_json'),
    errorMessage: text('error_message'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index('jobs_org_status_idx').on(table.organizationId, table.status),
  ],
);

// Drizzle Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  datasets: many(datasets),
  briefings: many(briefings),
  stations: many(monitoringStations),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(organizationMembers),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationMembers.userId],
    references: [users.id],
  }),
}));

export const datasetsRelations = relations(datasets, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [datasets.organizationId],
    references: [organizations.id],
  }),
  mapping: one(datasetMappings, {
    fields: [datasets.id],
    references: [datasetMappings.datasetId],
  }),
  rawRecords: many(rawRecords),
  normalizedReadings: many(normalizedReadings),
  statisticalRuns: many(statisticalRuns),
}));

export const briefingsRelations = relations(briefings, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [briefings.organizationId],
    references: [organizations.id],
  }),
  dataset: one(datasets, {
    fields: [briefings.datasetId],
    references: [datasets.id],
  }),
  statisticalRun: one(statisticalRuns, {
    fields: [briefings.statisticalRunId],
    references: [statisticalRuns.id],
  }),
  recommendations: many(recommendations),
  advisories: many(citizenAdvisories),
}));

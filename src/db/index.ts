import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

const dbPath = path.resolve(process.cwd(), process.env.SQLITE_DB_PATH || './data/civic_aqi.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });

export function ensureDatabaseSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      org_type TEXT NOT NULL,
      default_aqi_standard TEXT NOT NULL DEFAULT 'CPCB_NAQI',
      default_language TEXT NOT NULL DEFAULT 'en',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS organization_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      assigned_locations_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS org_members_org_user_idx ON organization_members(organization_id, user_id);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx ON audit_logs(organization_id, created_at);

    CREATE TABLE IF NOT EXISTS monitoring_stations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT,
      latitude REAL,
      longitude REAL,
      zone_type TEXT NOT NULL DEFAULT 'unknown',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS stations_org_name_idx ON monitoring_stations(organization_id, name);

    CREATE TABLE IF NOT EXISTS datasets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      original_filename TEXT,
      file_hash TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending_mapping',
      error_message TEXT,
      time_range_start TEXT,
      time_range_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS datasets_org_created_idx ON datasets(organization_id, created_at);

    CREATE TABLE IF NOT EXISTS dataset_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL UNIQUE REFERENCES datasets(id) ON DELETE CASCADE,
      detected_schema_json TEXT NOT NULL,
      confirmed_mapping_json TEXT,
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS raw_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      raw_payload_json TEXT NOT NULL,
      parse_warnings_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS raw_records_dataset_row_idx ON raw_records(dataset_id, row_index);

    CREATE TABLE IF NOT EXISTS normalized_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      raw_record_id INTEGER NOT NULL REFERENCES raw_records(id) ON DELETE CASCADE,
      station_id INTEGER REFERENCES monitoring_stations(id) ON DELETE SET NULL,
      location_name TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      recorded_at TEXT,
      pollutant TEXT NOT NULL,
      original_value TEXT,
      original_unit TEXT,
      normalized_value REAL,
      canonical_unit TEXT NOT NULL,
      qc_flag TEXT NOT NULL,
      transformation_log_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS norm_readings_query_idx ON normalized_readings(organization_id, dataset_id, location_name, pollutant, recorded_at);
    CREATE INDEX IF NOT EXISTS norm_readings_qc_idx ON normalized_readings(organization_id, dataset_id, qc_flag, pollutant);

    CREATE TABLE IF NOT EXISTS statistical_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      aqi_standard TEXT NOT NULL,
      summary_metrics_json TEXT NOT NULL,
      trend_analysis_json TEXT NOT NULL,
      data_quality_report_json TEXT NOT NULL,
      computed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS stat_runs_org_dataset_idx ON statistical_runs(organization_id, dataset_id);

    CREATE TABLE IF NOT EXISTS hotspots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      statistical_run_id INTEGER NOT NULL REFERENCES statistical_runs(id) ON DELETE CASCADE,
      location_name TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      severity TEXT NOT NULL,
      composite_score REAL NOT NULL,
      dominant_pollutant TEXT NOT NULL,
      exceedance_frequency_pct REAL NOT NULL,
      peak_value REAL NOT NULL,
      mean_value REAL NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      methodology_version TEXT NOT NULL DEFAULT 'v1.0'
    );
    CREATE INDEX IF NOT EXISTS hotspots_run_org_idx ON hotspots(statistical_run_id, organization_id);

    CREATE TABLE IF NOT EXISTS briefings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
      statistical_run_id INTEGER NOT NULL REFERENCES statistical_runs(id) ON DELETE CASCADE,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      stakeholder_type TEXT NOT NULL,
      title TEXT NOT NULL,
      executive_summary TEXT NOT NULL,
      structured_findings_json TEXT NOT NULL,
      data_quality_notes_json TEXT NOT NULL,
      risks_and_uncertainties_json TEXT NOT NULL,
      ai_metadata_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS briefings_org_stakeholder_idx ON briefings(organization_id, stakeholder_type, created_at);

    CREATE TABLE IF NOT EXISTS briefing_comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      current_briefing_id INTEGER NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
      previous_briefing_id INTEGER NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
      is_comparable INTEGER NOT NULL,
      incomparability_reasons_json TEXT NOT NULL DEFAULT '[]',
      delta_metrics_json TEXT NOT NULL,
      summary_narrative TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS comparisons_org_created_idx ON briefing_comparisons(organization_id, created_at);

    CREATE TABLE IF NOT EXISTS recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      briefing_id INTEGER NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
      stakeholder_type TEXT NOT NULL,
      title TEXT NOT NULL,
      rationale TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      impact_score INTEGER NOT NULL,
      urgency TEXT NOT NULL,
      feasibility TEXT NOT NULL,
      responsible_unit TEXT NOT NULL,
      suggested_timeline TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed'
    );
    CREATE INDEX IF NOT EXISTS recommendations_briefing_org_idx ON recommendations(briefing_id, organization_id);

    CREATE TABLE IF NOT EXISTS citizen_advisories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      briefing_id INTEGER NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
      reading_level TEXT NOT NULL,
      language TEXT NOT NULL,
      headline TEXT NOT NULL,
      current_condition_summary TEXT NOT NULL,
      health_guidance TEXT NOT NULL,
      children_guidance TEXT NOT NULL,
      older_adults_guidance TEXT NOT NULL,
      sensitive_groups_guidance TEXT NOT NULL,
      outdoor_activity_guidance TEXT NOT NULL,
      safety_check_passed INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS advisories_briefing_level_lang_idx ON citizen_advisories(briefing_id, reading_level, language);

    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      progress_pct INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      result_ref_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS jobs_org_status_idx ON background_jobs(organization_id, status);
  `);
}

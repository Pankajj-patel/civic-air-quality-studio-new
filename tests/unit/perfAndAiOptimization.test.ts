import '../helpers/testDbEnv.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../../server.ts';
import { db, ensureDatabaseSchema, sqlite } from '../../src/db/index.ts';
import { citizenAdvisories } from '../../src/db/schema.ts';
import { generateCitizenAdvisories } from '../../src/server/services/ai/advisoryGenerator.ts';

let server: http.Server;
let baseUrl = '';
let authToken = '';
let orgId = 0;
let datasetId = 0;
let briefingId = 0;

async function jsonFetch<T>(
  path: string,
  options: RequestInit & { token?: string; orgId?: number } = {},
): Promise<{ status: number; body: T }> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.orgId) headers.set('X-Organization-Id', String(options.orgId));

  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

before(async () => {
  ensureDatabaseSchema();
  const app = await createApp({ authRateLimitMax: 200 });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  baseUrl = `http://127.0.0.1:${addr.port}`;

  const suffix = Date.now();
  const regRes = await jsonFetch<{
    token: string;
    user: { id: number; memberships: Array<{ organizationId: number }> };
  }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `perf_${suffix}@civic.test`,
      password: 'PerfCheck#Password99',
      fullName: 'Perf Tester',
      organizationName: `Perf Civic Ward ${suffix}`,
      orgType: 'municipality',
    }),
  });
  assert.equal(regRes.status, 201);
  authToken = regRes.body.token;
  orgId = regRes.body.user.memberships[0].organizationId;

  // Create a 60-row dataset so pagination limit=25 / offset=25 / total=60+ is exercised cleanly
  const lines = ['Location,Recorded_At,PM2.5 (ug/m3)'];
  for (let i = 0; i < 65; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    lines.push(`Station ${i % 2 === 0 ? 'Alpha' : 'Beta'},2026-10-${day},${40 + (i % 50)}`);
  }

  const uploadRes = await jsonFetch<{ dataset: { id: number } }>('/api/datasets/upload', {
    method: 'POST',
    token: authToken,
    orgId,
    body: JSON.stringify({
      title: `Perf Dataset ${suffix}`,
      sourceType: 'paste',
      rawText: lines.join('\n'),
    }),
  });
  assert.equal(uploadRes.status, 201);
  datasetId = uploadRes.body.dataset.id;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('Performance, Indexing, Pagination & AI Caching', () => {
  it('verifies SQLite EXPLAIN QUERY PLAN uses composite indexes for core queries', () => {
    const queries = [
      {
        name: 'normalized_readings by org+dataset+qcFlag',
        sql: "EXPLAIN QUERY PLAN SELECT id, location_name, pollutant, normalized_value FROM normalized_readings WHERE organization_id = 1 AND dataset_id = 1 AND qc_flag = 'valid' LIMIT 50 OFFSET 0",
      },
      {
        name: 'statistical_runs by org+dataset',
        sql: 'EXPLAIN QUERY PLAN SELECT id FROM statistical_runs WHERE organization_id = 1 AND dataset_id = 1 ORDER BY id DESC LIMIT 1',
      },
      {
        name: 'hotspots by run+org',
        sql: 'EXPLAIN QUERY PLAN SELECT id FROM hotspots WHERE statistical_run_id = 1 AND organization_id = 1',
      },
      {
        name: 'recommendations by briefing+org',
        sql: 'EXPLAIN QUERY PLAN SELECT id FROM recommendations WHERE briefing_id = 1 AND organization_id = 1',
      },
      {
        name: 'briefing_comparisons by org',
        sql: 'EXPLAIN QUERY PLAN SELECT id FROM briefing_comparisons WHERE organization_id = 1 ORDER BY id DESC',
      },
      {
        name: 'background_jobs by org+status',
        sql: "EXPLAIN QUERY PLAN SELECT id FROM background_jobs WHERE organization_id = 1 AND status = 'running'",
      },
    ];

    for (const q of queries) {
      const planRows = sqlite.prepare(q.sql).all() as Array<{ detail: string }>;
      const combined = planRows.map((r) => r.detail).join(' | ');
      assert.match(
        combined,
        /USING (COVERING )?INDEX/i,
        `Expected query plan for "${q.name}" to use an index, got: ${combined}`,
      );
    }
  });

  it('supports async confirm-mapping (?async=true -> 202 + background job polling) and paginated /readings', async () => {
    const mapRes = await jsonFetch<{ async: boolean; jobId: string }>(
      `/api/datasets/${datasetId}/confirm-mapping?async=true`,
      {
        method: 'POST',
        token: authToken,
        orgId,
        body: JSON.stringify({
          locationColumn: 'Location',
          timestampColumn: 'Recorded_At',
          dateFormatHint: 'ISO',
          pollutantColumns: [
            { sourceColumn: 'PM2.5 (ug/m3)', pollutant: 'PM25', sourceUnit: 'µg/m³' },
          ],
        }),
      },
    );
    assert.equal(mapRes.status, 202);
    assert.equal(mapRes.body.async, true);
    assert.ok(mapRes.body.jobId);

    // Poll job to completion
    let status = 'queued';
    for (let i = 0; i < 40; i++) {
      const jobRes = await jsonFetch<{ job: { status: string; progressPct: number } }>(
        `/api/jobs/${mapRes.body.jobId}`,
        { token: authToken, orgId },
      );
      status = jobRes.body.job.status;
      if (status === 'completed' || status === 'failed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(status, 'completed');

    // Verify paginated /readings metadata (total, limit, offset, hasMore)
    const page1 = await jsonFetch<{
      readings: Array<{ id: number }>;
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    }>(`/api/datasets/${datasetId}/readings?limit=25&offset=0`, {
      token: authToken,
      orgId,
    });
    assert.equal(page1.status, 200);
    assert.equal(page1.body.readings.length, 25);
    assert.equal(page1.body.total, 65);
    assert.equal(page1.body.limit, 25);
    assert.equal(page1.body.offset, 0);
    assert.equal(page1.body.hasMore, true);

    const page3 = await jsonFetch<{
      readings: Array<{ id: number }>;
      total: number;
      hasMore: boolean;
    }>(`/api/datasets/${datasetId}/readings?limit=25&offset=50`, {
      token: authToken,
      orgId,
    });
    assert.equal(page3.status, 200);
    assert.equal(page3.body.readings.length, 15);
    assert.equal(page3.body.hasMore, false);
  });

  it('returns cacheHit=true from generateCitizenAdvisories when advisories already exist for briefingId+readingLevel', async () => {
    const statRow = sqlite
      .prepare('SELECT id FROM statistical_runs WHERE organization_id = ? AND dataset_id = ? LIMIT 1')
      .get(orgId, datasetId) as { id: number };
    const userRow = sqlite
      .prepare('SELECT id FROM users ORDER BY id DESC LIMIT 1')
      .get() as { id: number };

    const inserted = sqlite
      .prepare(
        `INSERT INTO briefings (organization_id, dataset_id, statistical_run_id, created_by, stakeholder_type, title, executive_summary, structured_findings_json, data_quality_notes_json, risks_and_uncertainties_json, ai_metadata_json, status)
         VALUES (?, ?, ?, ?, 'municipal_ward_officer', 'Cached Advisory Briefing', 'Summary', '[]', '[]', '[]', '{"provider":"gemini","model":"gemini-4-hydrogen","verificationPassed":true,"mismatchesFound":[],"generatedAt":"2026-11-01T00:00:00Z"}', 'verified')`,
      )
      .run(orgId, datasetId, statRow.id, userRow.id);
    briefingId = Number(inserted.lastInsertRowid);

    for (const lang of ['en', 'hi'] as const) {
      await db.insert(citizenAdvisories).values({
        organizationId: orgId,
        briefingId,
        readingLevel: 'simple',
        language: lang,
        headline: `Cached ${lang}`,
        currentConditionSummary: 'Summary',
        healthGuidance: 'Guidance',
        childrenGuidance: 'Children',
        olderAdultsGuidance: 'Older adults',
        sensitiveGroupsGuidance: 'Sensitive',
        outdoorActivityGuidance: 'Outdoor',
        safetyCheckPassed: true,
      });
    }

    const result = await generateCitizenAdvisories({
      organizationId: orgId,
      userId: userRow.id,
      briefingId,
      readingLevel: 'simple',
      languages: ['en', 'hi'],
    });
    assert.equal(result.cacheHit, true);
  });
});

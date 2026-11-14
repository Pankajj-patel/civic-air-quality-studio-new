import '../helpers/testDbEnv.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../../server.ts';
import { db } from '../../src/db/index.ts';
import { briefings, recommendations } from '../../src/db/schema.ts';

let server: http.Server;
let baseUrl: string;

async function api(
  path: string,
  opts: {
    method?: string;
    token?: string;
    orgId?: number;
    body?: unknown;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.orgId) headers['x-organization-id'] = String(opts.orgId);
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/pdf')) {
    const arrBuf = await res.arrayBuffer();
    return { status: res.status, headers: res.headers, buffer: Buffer.from(arrBuf), json: null as any };
  }
  const json = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, json, buffer: null as Buffer | null };
}

describe('API Integration, Multi-Tenant Isolation, RBAC & PDF Export', () => {
  before(async () => {
    const app = await createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('serves health check and enforces auth + duplicate email protection', async () => {
    const health = await api('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.status, 'ok');
    assert.equal(health.json.database, 'sqlite');

    const unauth = await api('/api/auth/me');
    assert.equal(unauth.status, 401);

    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: 'admin-a@ward.gov',
        password: 'Password123!',
        fullName: 'Admin Alpha',
        organizationName: 'Ward 12 Municipal Office',
        orgType: 'municipality',
      },
    });
    assert.equal(reg.status, 201);
    assert.ok(reg.json.token);
    assert.equal(reg.json.user.memberships[0].role, 'org_admin');

    const dup = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: 'admin-a@ward.gov',
        password: 'Password123!',
        fullName: 'Duplicate',
      },
    });
    assert.equal(dup.status, 409);

    const badLogin = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin-a@ward.gov', password: 'WrongPassword!' },
    });
    assert.equal(badLogin.status, 401);
  });

  it('enforces strict tenant isolation, RBAC, location scoping, comparison, and PDF binary export', async () => {
    // 1. Login Org A admin & register Org B admin
    const loginA = await api('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin-a@ward.gov', password: 'Password123!' },
    });
    const tokenA = loginA.json.token as string;
    const orgAId = loginA.json.user.memberships[0].organizationId as number;

    const regB = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: 'admin-b@society.org',
        password: 'Password123!',
        fullName: 'Admin Beta',
        organizationName: 'Greenwood Housing Society',
        orgType: 'housing_society',
      },
    });
    const tokenB = regB.json.token as string;
    const orgBId = regB.json.user.memberships[0].organizationId as number;

    // 2. Org A invites a Viewer and a location-scoped Ward Officer ("Sector 12" only)
    const regViewer = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: 'viewer-a@ward.gov',
        password: 'Password123!',
        fullName: 'Citizen Viewer',
      },
    });
    const viewerToken = regViewer.json.token as string;

    const inviteViewer = await api(`/api/orgs/${orgAId}/members`, {
      method: 'POST',
      token: tokenA,
      orgId: orgAId,
      body: {
        email: 'viewer-a@ward.gov',
        role: 'viewer',
        assignedLocations: [],
      },
    });
    assert.equal(inviteViewer.status, 201);

    const regScoped = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: 'officer-s12@ward.gov',
        password: 'Password123!',
        fullName: 'Sector 12 Officer',
      },
    });
    const scopedToken = regScoped.json.token as string;

    await api(`/api/orgs/${orgAId}/members`, {
      method: 'POST',
      token: tokenA,
      orgId: orgAId,
      body: {
        email: 'officer-s12@ward.gov',
        role: 'ward_officer',
        assignedLocations: ['Sector 12'],
      },
    });

    // 3. Viewer cannot upload dataset or read audit logs
    const viewerUpload = await api('/api/datasets/upload', {
      method: 'POST',
      token: viewerToken,
      orgId: orgAId,
      body: {
        title: 'Blocked Upload',
        sourceType: 'paste',
        rawText: 'Location,Date,PM25\nSector 12,2026-04-01,80',
      },
    });
    assert.equal(viewerUpload.status, 403);

    const viewerAudit = await api(`/api/orgs/${orgAId}/audit-logs`, {
      token: viewerToken,
      orgId: orgAId,
    });
    assert.equal(viewerAudit.status, 403);

    // 4. Org A Admin uploads & normalizes two datasets across Sector 12 and Industrial Belt
    const upload1 = await api('/api/datasets/upload', {
      method: 'POST',
      token: tokenA,
      orgId: orgAId,
      body: {
        title: 'Week 1 Ward Readings',
        sourceType: 'paste',
        rawText: [
          'Location,Date,PM25,Lat,Lon',
          'Sector 12,2026-04-01,130,28.61,77.21',
          'Sector 12,2026-04-02,145,28.61,77.21',
          'Industrial Belt,2026-04-01,210,28.65,77.25',
          'Industrial Belt,2026-04-02,220,28.65,77.25',
        ].join('\n'),
      },
    });
    assert.equal(upload1.status, 201);
    const ds1Id = upload1.json.dataset.id as number;

    const confirm1 = await api(`/api/datasets/${ds1Id}/confirm-mapping`, {
      method: 'POST',
      token: tokenA,
      orgId: orgAId,
      body: {
        locationColumn: 'Location',
        timestampColumn: 'Date',
        latitudeColumn: 'Lat',
        longitudeColumn: 'Lon',
        dateFormatHint: 'ISO',
        pollutantColumns: [{ sourceColumn: 'PM25', pollutant: 'PM25', sourceUnit: 'µg/m³' }],
      },
    });
    assert.equal(confirm1.status, 200);
    const run1Id = confirm1.json.statisticalRunId as number;

    // 5. Location-scoped Ward Officer only sees Sector 12 in /stats, /hotspots, and /readings
    const scopedStats = await api(`/api/datasets/${ds1Id}/stats`, {
      token: scopedToken,
      orgId: orgAId,
    });
    assert.equal(scopedStats.status, 200);
    assert.equal(scopedStats.json.locationSummaries.length, 1);
    assert.equal(scopedStats.json.locationSummaries[0].locationName, 'Sector 12');

    const scopedHotspots = await api(`/api/datasets/${ds1Id}/hotspots`, {
      token: scopedToken,
      orgId: orgAId,
    });
    assert.equal(scopedHotspots.status, 200);
    assert.ok(scopedHotspots.json.hotspots.every((h: any) => h.locationName === 'Sector 12'));

    // 6. Cross-Tenant Isolation: Org B cannot access Org A's dataset or forge x-organization-id for Org A
    const crossHeader = await api(`/api/datasets/${ds1Id}/preview`, {
      token: tokenB,
      orgId: orgAId,
    });
    assert.equal(crossHeader.status, 403);

    const crossDataset = await api(`/api/datasets/${ds1Id}/preview`, {
      token: tokenB,
      orgId: orgBId,
    });
    assert.equal(crossDataset.status, 404);

    // Invalid ID handling
    const badIdRes = await api('/api/datasets/not-a-number/stats', {
      token: tokenA,
      orgId: orgAId,
    });
    assert.equal(badIdRes.status, 400);

    // 7. Second dataset + two briefings seeded to test Briefing API, Status Update, Comparison & PDF Export
    const upload2 = await api('/api/datasets/upload', {
      method: 'POST',
      token: tokenA,
      orgId: orgAId,
      body: {
        title: 'Week 2 Ward Readings',
        sourceType: 'paste',
        rawText: [
          'Location,Date,PM25',
          'Sector 12,2026-04-08,75',
          'Sector 12,2026-04-09,80',
          'Industrial Belt,2026-04-08,160',
          'Industrial Belt,2026-04-09,155',
        ].join('\n'),
      },
    });
    const ds2Id = upload2.json.dataset.id as number;
    const confirm2 = await api(`/api/datasets/${ds2Id}/confirm-mapping`, {
      method: 'POST',
      token: tokenA,
      orgId: orgAId,
      body: {
        locationColumn: 'Location',
        timestampColumn: 'Date',
        dateFormatHint: 'ISO',
        pollutantColumns: [{ sourceColumn: 'PM25', pollutant: 'PM25', sourceUnit: 'µg/m³' }],
      },
    });
    const run2Id = confirm2.json.statisticalRunId as number;

    const b1 = db
      .insert(briefings)
      .values({
        organizationId: orgAId,
        datasetId: ds1Id,
        statisticalRunId: run1Id,
        createdBy: loginA.json.user.id,
        stakeholderType: 'municipal_ward_officer',
        title: 'Week 1 Municipal Briefing',
        executiveSummary: 'PM2.5 elevated across Sector 12 and Industrial Belt.',
        structuredFindingsJson: JSON.stringify([
          {
            id: 'f1',
            category: 'calculated_statistic',
            title: 'Industrial Belt Peak Exceedance',
            narrative: 'PM2.5 reached 220 µg/m³.',
            confidence: 'high',
            evidenceRefs: [{ datasetId: ds1Id, locationName: 'Industrial Belt', observedValue: 220, unit: 'µg/m³' }],
          },
        ]),
        dataQualityNotesJson: JSON.stringify(['100% completeness.']),
        risksAndUncertaintiesJson: JSON.stringify(['2-day sampling snapshot.']),
        aiMetadataJson: JSON.stringify({ provider: 'gemini', model: 'gemini-4-hydrogen', verificationPassed: true }),
        status: 'verified',
      })
      .returning()
      .get();

    const rec1 = db
      .insert(recommendations)
      .values({
        organizationId: orgAId,
        briefingId: b1.id,
        stakeholderType: 'municipal_ward_officer',
        title: 'Water sprinkling along Industrial Belt road corridor',
        rationale: 'PM2.5 exceeded 200 µg/m³.',
        evidenceRefsJson: JSON.stringify([{ datasetId: ds1Id, locationName: 'Industrial Belt', observedValue: 220 }]),
        impactScore: 5,
        urgency: 'immediate',
        feasibility: 'high',
        responsibleUnit: 'Ward Sanitation Dept',
        suggestedTimeline: '24 hours',
        status: 'proposed',
      })
      .returning()
      .get();

    const b2 = db
      .insert(briefings)
      .values({
        organizationId: orgAId,
        datasetId: ds2Id,
        statisticalRunId: run2Id,
        createdBy: loginA.json.user.id,
        stakeholderType: 'municipal_ward_officer',
        title: 'Week 2 Municipal Briefing',
        executiveSummary: 'PM2.5 declined across both zones compared to Week 1.',
        structuredFindingsJson: JSON.stringify([]),
        dataQualityNotesJson: JSON.stringify(['100% completeness.']),
        risksAndUncertaintiesJson: JSON.stringify([]),
        aiMetadataJson: JSON.stringify({ provider: 'gemini', model: 'gemini-4-hydrogen', verificationPassed: true }),
        status: 'verified',
      })
      .returning()
      .get();

    // Update briefing & recommendation status (viewer blocked, admin allowed)
    const viewerPublish = await api(`/api/briefings/${b2.id}/status`, {
      method: 'PATCH',
      token: viewerToken,
      orgId: orgAId,
      body: { status: 'published' },
    });
    assert.equal(viewerPublish.status, 403);

    const adminPublish = await api(`/api/briefings/${b2.id}/status`, {
      method: 'PATCH',
      token: tokenA,
      orgId: orgAId,
      body: { status: 'published' },
    });
    assert.equal(adminPublish.status, 200);
    assert.equal(adminPublish.json.briefing.status, 'published');

    const recPatch = await api(`/api/briefings/recommendations/${rec1.id}`, {
      method: 'PATCH',
      token: tokenA,
      orgId: orgAId,
      body: { status: 'completed' },
    });
    assert.equal(recPatch.status, 200);
    assert.equal(recPatch.json.recommendation.status, 'completed');

    // Viewer cannot create comparisons (403 INSUFFICIENT_ROLE)
    const viewerComp = await api('/api/comparisons', {
      method: 'POST',
      token: viewerToken,
      orgId: orgAId,
      body: { currentBriefingId: b2.id, previousBriefingId: b1.id },
    });
    assert.equal(viewerComp.status, 403);

    // Run comparison via API as Org A admin
    const compRes = await api('/api/comparisons', {
      method: 'POST',
      token: tokenA,
      orgId: orgAId,
      body: { currentBriefingId: b2.id, previousBriefingId: b1.id },
    });
    assert.equal(compRes.status, 201);
    assert.equal(compRes.json.comparison.isComparable, true);
    assert.equal(compRes.json.comparison.deltaMetrics.pollutantDeltas[0].direction, 'improved');

    // Location-scoped Ward Officer ("Sector 12") is blocked from org-wide briefing b1 (mentions Industrial Belt)
    const scopedList = await api('/api/briefings', {
      token: scopedToken,
      orgId: orgAId,
    });
    assert.equal(scopedList.status, 200);
    assert.equal(scopedList.json.briefings.some((b: any) => b.id === b1.id), false);

    const scopedReadB1 = await api(`/api/briefings/${b1.id}`, {
      token: scopedToken,
      orgId: orgAId,
    });
    assert.equal(scopedReadB1.status, 403);

    const scopedPdfB1 = await api(`/api/briefings/${b1.id}/export/pdf`, {
      token: scopedToken,
      orgId: orgAId,
    });
    assert.equal(scopedPdfB1.status, 403);

    // A briefing strictly referencing Sector 12 IS accessible to the Sector 12 ward officer
    const bScoped = db
      .insert(briefings)
      .values({
        organizationId: orgAId,
        datasetId: ds1Id,
        statisticalRunId: run1Id,
        createdBy: loginA.json.user.id,
        stakeholderType: 'municipal_ward_officer',
        title: 'Sector 12 Ward Briefing',
        executiveSummary: 'PM2.5 elevated in Sector 12.',
        structuredFindingsJson: JSON.stringify([
          {
            id: 'f-s12',
            category: 'calculated_statistic',
            title: 'Sector 12 Mean Exceedance',
            narrative: 'Sector 12 averaged 137.5 µg/m³.',
            confidence: 'high',
            evidenceRefs: [{ datasetId: ds1Id, locationName: 'Sector 12', observedValue: 137.5, unit: 'µg/m³' }],
          },
        ]),
        dataQualityNotesJson: JSON.stringify(['100% completeness.']),
        risksAndUncertaintiesJson: JSON.stringify([]),
        aiMetadataJson: JSON.stringify({ provider: 'gemini', model: 'gemini-4-hydrogen', verificationPassed: true }),
        status: 'verified',
      })
      .returning()
      .get();

    const scopedReadOwn = await api(`/api/briefings/${bScoped.id}`, {
      token: scopedToken,
      orgId: orgAId,
    });
    assert.equal(scopedReadOwn.status, 200);

    const scopedPdfOwn = await api(`/api/briefings/${bScoped.id}/export/pdf`, {
      token: scopedToken,
      orgId: orgAId,
    });
    assert.equal(scopedPdfOwn.status, 200);
    assert.ok(scopedPdfOwn.buffer && scopedPdfOwn.buffer.subarray(0, 5).toString('ascii') === '%PDF-');

    // PDF Export returns valid %PDF- binary and is blocked for Org B
    const pdfOk = await api(`/api/briefings/${b1.id}/export/pdf`, {
      token: tokenA,
      orgId: orgAId,
    });
    assert.equal(pdfOk.status, 200);
    assert.ok(pdfOk.buffer && pdfOk.buffer.subarray(0, 5).toString('ascii') === '%PDF-');

    const pdfCrossTenant = await api(`/api/briefings/${b1.id}/export/pdf`, {
      token: tokenB,
      orgId: orgBId,
    });
    assert.equal(pdfCrossTenant.status, 404);

    // Org A Admin audit log captures actions
    const auditRes = await api(`/api/orgs/${orgAId}/audit-logs`, {
      token: tokenA,
      orgId: orgAId,
    });
    assert.equal(auditRes.status, 200);
    const actions = auditRes.json.logs.map((l: any) => l.action);
    assert.ok(actions.includes('DATASET_UPLOADED'));
    assert.ok(actions.includes('PDF_EXPORTED'));
    assert.ok(actions.includes('BRIEFING_COMPARISON_RUN'));
  });

  it('enforces password policy, no-store API headers, CORS allowlist, and strict auth rate limiting', async () => {
    // 1. Weak password rejected
    const weakReg = await api('/api/auth/register', {
      method: 'POST',
      body: {
        email: 'weak-user@ward.gov',
        password: 'password123',
        fullName: 'Weak Pass',
      },
    });
    assert.equal(weakReg.status, 400);

    // 2. Cache-Control: no-store present on API responses
    const health = await api('/api/health');
    assert.ok((health.headers.get('cache-control') || '').includes('no-store'));

    // 3. Untrusted CORS origin rejected on /api/*
    const evilCors = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://evil-attacker.example.com' },
    });
    assert.equal(evilCors.status, 403);
    const evilJson = await evilCors.json();
    assert.equal(evilJson.error.code, 'CORS_ORIGIN_DENIED');

    // 4. Dedicated auth rate limiter triggers 429 after max attempts
    const limitedApp = await createApp({ authRateLimitMax: 2 });
    const limitedServer = await new Promise<http.Server>((resolve) => {
      const s = limitedApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = limitedServer.address() as { port: number };
      const limitedUrl = `http://127.0.0.1:${addr.port}`;
      for (let i = 0; i < 2; i++) {
        await fetch(`${limitedUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'nobody@ward.gov', password: 'WrongPassword1!' }),
        });
      }
      const blocked = await fetch(`${limitedUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@ward.gov', password: 'WrongPassword1!' }),
      });
      assert.equal(blocked.status, 429);
      const blockedJson = await blocked.json();
      assert.equal(blockedJson.error.code, 'AUTH_RATE_LIMITED');
    } finally {
      await new Promise<void>((resolve) => limitedServer.close(() => resolve()));
    }
  });
});

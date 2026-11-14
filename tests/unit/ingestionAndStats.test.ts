import '../helpers/testDbEnv.ts';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import * as XLSX from 'xlsx';
import { db, ensureDatabaseSchema } from '../../src/db/index.ts';
import {
  datasetMappings,
  datasets,
  hotspots,
  normalizedReadings,
  organizations,
  rawRecords,
  users,
} from '../../src/db/schema.ts';
import { runDeterministicAnalytics } from '../../src/server/services/analytics/statsEngine.ts';
import { normalizeDatasetRecords } from '../../src/server/services/ingestion/normalizer.ts';
import {
  detectSchemaFromRows,
  parseCsvString,
  parseUploadedFileBuffer,
} from '../../src/server/services/ingestion/parser.ts';
import {
  convertToCanonicalUnit,
  normalizeUnitLabel,
} from '../../src/shared/standards/aqiStandards.ts';

describe('Unit Conversions & AQI Standards', () => {
  it('normalizes unit label aliases accurately', () => {
    assert.equal(normalizeUnitLabel('ug/m3'), 'µg/m³');
    assert.equal(normalizeUnitLabel(' µg/m³ '), 'µg/m³');
    assert.equal(normalizeUnitLabel('mg/m3'), 'mg/m³');
    assert.equal(normalizeUnitLabel('PPB'), 'ppb');
    assert.equal(normalizeUnitLabel('ppm'), 'ppm');
    assert.equal(normalizeUnitLabel('AQI'), 'index');
    assert.equal(normalizeUnitLabel(null), 'unknown');
  });

  it('converts PM2.5 mg/m³ to µg/m³ and CO µg/m³ or ppm to mg/m³', () => {
    const pm = convertToCanonicalUnit(0.125, 'PM25', 'mg/m3');
    assert.equal(pm.canonicalUnit, 'µg/m³');
    assert.equal(pm.value, 125);

    const coFromUg = convertToCanonicalUnit(2500, 'CO', 'ug/m3');
    assert.equal(coFromUg.canonicalUnit, 'mg/m³');
    assert.equal(coFromUg.value, 2.5);

    const coFromPpm = convertToCanonicalUnit(1.0, 'CO', 'ppm');
    assert.equal(coFromPpm.canonicalUnit, 'mg/m³');
    assert.ok(Math.abs(coFromPpm.value - 1.1456) < 0.001);

    const no2FromPpb = convertToCanonicalUnit(40, 'NO2', 'ppb');
    assert.equal(no2FromPpb.canonicalUnit, 'µg/m³');
    assert.ok(Math.abs(no2FromPpb.value - 75.264) < 0.05);
  });
});

describe('Messy CSV & Excel Parser', () => {
  it('parses messy CSV headers, inline units, missing values, and flags ambiguous DMY dates', () => {
    const csv = [
      'Monitoring Site,Date,PM_2_5 (ug/m3),CO (mg/m3)',
      'Ward 14 Market,03/04/2026,112.5 µg/m³,1.4',
      'Ward 14 Market,05/04/2026,BDL,NA',
      'Sector 7 School,06/04/2026,-,0.9',
    ].join('\n');

    const { headers, rows } = parseCsvString(csv);
    const schema = detectSchemaFromRows(headers, rows);

    const locCol = schema.detectedColumns.find((c) => c.header === 'Monitoring Site');
    const tsCol = schema.detectedColumns.find((c) => c.header === 'Date');
    const pmCol = schema.detectedColumns.find((c) => c.header === 'PM_2_5 (ug/m3)');
    const coCol = schema.detectedColumns.find((c) => c.header === 'CO (mg/m3)');

    assert.equal(locCol?.suggestedRole, 'location');
    assert.equal(tsCol?.suggestedRole, 'timestamp');
    assert.equal(pmCol?.suggestedRole, 'pollutant');
    assert.equal(pmCol?.suggestedPollutant, 'PM25');
    assert.equal(pmCol?.suggestedUnit, 'µg/m³');
    assert.equal(pmCol?.missingCount, 2); // BDL and -
    assert.equal(coCol?.suggestedPollutant, 'CO');
    assert.equal(coCol?.missingCount, 1); // NA
    assert.ok(schema.warnings.some((w) => /Ambiguous DD\/MM vs MM\/DD/i.test(w)));
  });

  it('parses uploaded .xlsx buffer and rejects unsupported extensions', () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([
      { Station: 'Main Chowk', Recorded: '2026-04-01', PM10: 145, NO2: 64 },
      { Station: 'Main Chowk', Recorded: '2026-04-02', PM10: 162, NO2: 70 },
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Readings');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const parsed = parseUploadedFileBuffer('ward_readings.xlsx', buf);
    assert.equal(parsed.sourceType, 'xlsx');
    assert.equal(parsed.rows.length, 2);
    assert.equal(
      parsed.detectedSchema.detectedColumns.find((c) => c.header === 'PM10')?.suggestedPollutant,
      'PM10',
    );

    assert.throws(
      () => parseUploadedFileBuffer('malware.exe', Buffer.from('bad')),
      /Only \.csv, \.tsv, \.xlsx, and \.xls files are supported/,
    );
  });
});

describe('Null-Preserving Normalization & Deterministic Analytics Edge Cases', () => {
  let orgId: number;
  let userId: number;

  before(() => {
    ensureDatabaseSchema();
    const org = db
      .insert(organizations)
      .values({
        name: 'Unit Test Municipality',
        slug: `unit-test-muni-${Date.now()}`,
        orgType: 'municipality',
        defaultAqiStandard: 'CPCB_NAQI',
        defaultLanguage: 'en',
      })
      .returning()
      .get();
    orgId = org.id;

    const user = db
      .insert(users)
      .values({
        email: `unit-${Date.now()}@civic.test`,
        passwordHash: 'hashed',
        fullName: 'Unit Tester',
      })
      .returning()
      .get();
    userId = user.id;
  });

  it('never converts missing readings to zero, suppresses duplicates, rejects negatives/outliers, and scores hotspots', async () => {
    const rawRows = [
      // Station A: 6 valid increasing PM2.5 readings + 1 duplicate + 1 missing + 1 negative + 1 physical outlier
      { Site: 'Station A', Date: '2026-04-01', PM25: '70', NO2: 'NA' },
      { Site: 'Station A', Date: '2026-04-02', PM25: '85', NO2: '' },
      { Site: 'Station A', Date: '2026-04-03', PM25: '110', NO2: 'BDL' },
      { Site: 'Station A', Date: '2026-04-04', PM25: '130', NO2: '-' },
      { Site: 'Station A', Date: '2026-04-05', PM25: '150', NO2: 'null' },
      { Site: 'Station A', Date: '2026-04-06', PM25: '180', NO2: 'NA' },
      { Site: 'Station A', Date: '2026-04-06', PM25: '180', NO2: 'NA' }, // duplicate
      { Site: 'Station A', Date: '2026-04-07', PM25: '', NO2: 'NA' }, // missing
      { Site: 'Station A', Date: '2026-04-08', PM25: '-12', NO2: 'NA' }, // negative
      { Site: 'Station A', Date: '2026-04-09', PM25: '2500', NO2: 'NA' }, // outlier (>2000)
      { Site: 'Station A', Date: 'not-a-date', PM25: '90', NO2: 'NA' }, // unparseable timestamp
      // Station B: very low completeness (1 valid out of 5 rows -> <30% -> watch)
      { Site: 'Station B', Date: '2026-04-01', PM25: '140', NO2: 'NA' },
      { Site: 'Station B', Date: '2026-04-02', PM25: 'NA', NO2: 'NA' },
      { Site: 'Station B', Date: '2026-04-03', PM25: 'NA', NO2: 'NA' },
      { Site: 'Station B', Date: '2026-04-04', PM25: 'NA', NO2: 'NA' },
      { Site: 'Station B', Date: '2026-04-05', PM25: 'NA', NO2: 'NA' },
    ];

    const ds = db
      .insert(datasets)
      .values({
        organizationId: orgId,
        uploadedBy: userId,
        title: 'Edge Case Dataset',
        sourceType: 'manual',
        fileHash: 'edge-hash',
        rowCount: rawRows.length,
        status: 'pending_mapping',
      })
      .returning()
      .get();

    db.insert(datasetMappings)
      .values({
        datasetId: ds.id,
        detectedSchemaJson: '{}',
      })
      .run();

    db.insert(rawRecords)
      .values(
        rawRows.map((r, idx) => ({
          datasetId: ds.id,
          rowIndex: idx + 1,
          rawPayloadJson: JSON.stringify(r),
          parseWarningsJson: '[]',
        })),
      )
      .run();

    await normalizeDatasetRecords({
      organizationId: orgId,
      datasetId: ds.id,
      userId,
      aqiStandard: 'CPCB_NAQI',
      mapping: {
        locationColumn: 'Site',
        timestampColumn: 'Date',
        dateFormatHint: 'ISO',
        pollutantColumns: [
          { sourceColumn: 'PM25', pollutant: 'PM25', sourceUnit: 'µg/m³' },
          { sourceColumn: 'NO2', pollutant: 'NO2', sourceUnit: 'µg/m³' },
        ],
      },
    });

    const normRows = await db
      .select()
      .from(normalizedReadings)
      .where((await import('drizzle-orm')).eq(normalizedReadings.datasetId, ds.id));

    // All NO2 rows must be qcFlag='missing' and normalizedValue=null (never 0)
    const no2Rows = normRows.filter((r) => r.pollutant === 'NO2');
    assert.equal(no2Rows.length, rawRows.length);
    assert.ok(no2Rows.every((r) => r.qcFlag === 'missing' && r.normalizedValue === null));

    // Verify QC flags for PM25 edge cases
    const pmRows = normRows.filter((r) => r.pollutant === 'PM25');
    assert.equal(pmRows.filter((r) => r.qcFlag === 'duplicate_suppressed').length, 1);
    assert.equal(pmRows.filter((r) => r.qcFlag === 'negative_rejected').length, 1);
    assert.equal(pmRows.filter((r) => r.qcFlag === 'suspect_outlier').length, 1);
    assert.equal(pmRows.filter((r) => r.qcFlag === 'unparseable_timestamp').length, 1);

    const stats = await runDeterministicAnalytics({
      organizationId: orgId,
      datasetId: ds.id,
      aqiStandard: 'CPCB_NAQI',
    });

    // All-missing NO2 must yield null mean/min/max and insufficient_data trend
    assert.equal(stats.globalSummary.NO2.validCount, 0);
    assert.equal(stats.globalSummary.NO2.mean, null);
    assert.equal(stats.globalSummary.NO2.trend, 'insufficient_data');

    // PM25 valid readings: Station A [70,85,110,130,150,180] + Station B [140] -> mean = 865/7 = 123.57
    assert.equal(stats.globalSummary.PM25.validCount, 7);
    assert.equal(stats.globalSummary.PM25.mean, 123.57);
    assert.equal(stats.globalSummary.PM25.exceedanceCount, 7); // All > CPCB PM2.5 limit 60

    const stationA = stats.locationSummaries.find((l) => l.locationName === 'Station A');
    assert.equal(stationA?.pollutants.PM25.trend, 'increasing');

    const storedHotspots = await db
      .select()
      .from(hotspots)
      .where((await import('drizzle-orm')).eq(hotspots.statisticalRunId, stats.statisticalRunId));

    const hsA = storedHotspots.find((h) => h.locationName === 'Station A');
    const hsB = storedHotspots.find((h) => h.locationName === 'Station B');
    assert.ok(hsA && (hsA.severity === 'critical' || hsA.severity === 'high'));
    // Station B had 20% completeness -> must be downgraded to watch
    assert.equal(hsB?.severity, 'watch');
  });
});

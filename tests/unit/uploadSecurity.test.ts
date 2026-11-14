import '../helpers/testDbEnv.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../src/server/middleware/errorHandler.ts';
import {
  parseCsvString,
  parseUploadedFileBuffer,
  sanitizeFilename,
  sanitizeSpreadsheetCell,
} from '../../src/server/services/ingestion/parser.ts';

describe('Upload & Spreadsheet Parser Security', () => {
  it('sanitizes filenames against path traversal and control bytes', () => {
    assert.equal(sanitizeFilename('../../etc/passwd.csv'), 'passwd.csv');
    assert.equal(sanitizeFilename('..\\..\\evil\u0000name.xlsx'), 'evilname.xlsx');
    assert.equal(sanitizeFilename('ward-12_air.csv'), 'ward-12_air.csv');
  });

  it('rejects spoofed .xlsx and .xls magic bytes and binary CSV payloads', () => {
    assert.throws(
      () =>
        parseUploadedFileBuffer(
          'fake.xlsx',
          Buffer.from('<script>alert(1)</script>'),
          undefined,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_FILE_SIGNATURE',
    );

    assert.throws(
      () =>
        parseUploadedFileBuffer(
          'fake.xls',
          Buffer.from('not-an-ole2-header-at-all'),
          undefined,
          'application/vnd.ms-excel',
        ),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_FILE_SIGNATURE',
    );

    assert.throws(
      () =>
        parseUploadedFileBuffer(
          'binary.csv',
          Buffer.from([0x4d, 0x5a, 0x00, 0x00, 0x50, 0x4b]),
          undefined,
          'text/csv',
        ),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_FILE_SIGNATURE',
    );
  });

  it('rejects disallowed MIME types on uploaded files', () => {
    assert.throws(
      () =>
        parseUploadedFileBuffer(
          'data.csv',
          Buffer.from('Location,Date,PM25\nWard 1,2026-04-01,55'),
          undefined,
          'text/html',
        ),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_MIME_TYPE',
    );

    assert.throws(
      () =>
        parseUploadedFileBuffer(
          'data.xlsx',
          Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]),
          undefined,
          'application/javascript',
        ),
      (err: unknown) => err instanceof AppError && err.code === 'INVALID_MIME_TYPE',
    );
  });

  it('neutralizes spreadsheet formula injection while preserving valid negative readings', () => {
    assert.equal(sanitizeSpreadsheetCell("=cmd|'/C calc'!A0"), "'=cmd|'/C calc'!A0");
    assert.equal(sanitizeSpreadsheetCell('@SUM(A1:A2)'), "'@SUM(A1:A2)");
    assert.equal(sanitizeSpreadsheetCell('=HYPERLINK("http://evil","click")'), '\'=HYPERLINK("http://evil","click")');
    assert.equal(sanitizeSpreadsheetCell('+cmd|calc'), "'+cmd|calc");
    assert.equal(sanitizeSpreadsheetCell('-cmd|calc'), "'-cmd|calc");
    // Valid negative numeric readings must remain untouched for QC negative_rejected handling
    assert.equal(sanitizeSpreadsheetCell('-5'), '-5');
    assert.equal(sanitizeSpreadsheetCell('-12.5 µg/m³'), '-12.5 µg/m³');

    const csv = parseCsvString('Location,Date,PM25\n=Ward1,2026-04-01,-5\nSector 2,2026-04-02,88');
    assert.equal(csv.rows[0].Location, "'=Ward1");
    assert.equal(csv.rows[0].PM25, '-5');
  });
});

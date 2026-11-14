import path from 'node:path';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { normalizeUnitLabel } from '../../../shared/standards/aqiStandards.ts';
import { Pollutant } from '../../../shared/types.ts';
import { AppError } from '../../middleware/errorHandler.ts';

export interface ServerDetectedColumn {
  header: string;
  suggestedRole: 'location' | 'timestamp' | 'time' | 'latitude' | 'longitude' | 'pollutant' | 'ignore';
  suggestedPollutant?: Pollutant;
  suggestedUnit: string;
  sampleValues: string[];
  missingCount: number;
}

export interface ServerDetectedSchema {
  headers: string[];
  detectedColumns: ServerDetectedColumn[];
  warnings: string[];
  dateFormatHint: 'auto' | 'DMY' | 'MDY' | 'ISO';
}

export interface ParsedRawDataset {
  title: string;
  sourceType: 'csv' | 'xlsx' | 'paste' | 'manual';
  originalFilename?: string;
  headers: string[];
  rows: Record<string, string>[];
  detectedSchema: ServerDetectedSchema;
}

const MAX_ROWS = 25_000;
const MAX_COLUMNS = 100;
const MAX_WORKBOOK_SHEETS = 50;

const ALLOWED_TEXT_MIMES = new Set([
  'text/csv',
  'text/plain',
  'text/tab-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

const ALLOWED_EXCEL_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

const NUMERIC_OR_UNIT_PATTERN = /^[+-]?\d+(?:\.\d+)?(?:\s*[a-zA-Zµ/%³3]+)?$/;

export function sanitizeFilename(rawFilename: string): string {
  const normalized = String(rawFilename || 'upload').replace(/[\u0000-\u001F\u007F]/g, '');
  const base = path.win32.basename(path.posix.basename(normalized));
  const cleaned = base
    .replace(/[/\\]+/g, '')
    .replace(/^\.+/, '')
    .replace(/\.\.+/g, '.')
    .trim()
    .slice(0, 180);
  return cleaned || 'upload';
}

export function sanitizeSpreadsheetCell(raw: unknown): string {
  if (raw == null) return '';
  const cleaned = String(raw).replace(/\u0000/g, '').slice(0, 500);
  const trimmed = cleaned.trimStart();
  if (trimmed.length === 0) return cleaned;
  if (trimmed === '-' || trimmed === '--') return cleaned;

  const first = trimmed[0];
  if (first === '=' || first === '@' || cleaned[0] === '\t' || cleaned[0] === '\r') {
    return `'${cleaned}`;
  }
  if ((first === '+' || first === '-') && !NUMERIC_OR_UNIT_PATTERN.test(trimmed)) {
    return `'${cleaned}`;
  }
  return cleaned;
}

export function validateUploadMimeType(ext: string, mimetype?: string): void {
  if (!mimetype) return;
  const normalizedMime = mimetype.split(';')[0].trim().toLowerCase();
  if (!normalizedMime) return;

  if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
    if (!ALLOWED_TEXT_MIMES.has(normalizedMime)) {
      throw new AppError(
        400,
        'INVALID_MIME_TYPE',
        `Unsupported MIME type "${normalizedMime}" for delimited text upload.`,
      );
    }
    return;
  }

  if (ext === '.xlsx' || ext === '.xls') {
    if (!ALLOWED_EXCEL_MIMES.has(normalizedMime)) {
      throw new AppError(
        400,
        'INVALID_MIME_TYPE',
        `Unsupported MIME type "${normalizedMime}" for Excel upload.`,
      );
    }
  }
}

function assertTextBufferIsNotBinary(buffer: Buffer): void {
  if (buffer.length === 0) {
    throw new AppError(400, 'EMPTY_FILE', 'Uploaded file is empty.');
  }
  const sampleLen = Math.min(buffer.length, 8192);
  let controlCount = 0;
  for (let i = 0; i < sampleLen; i++) {
    const byte = buffer[i];
    if (byte === 0) {
      throw new AppError(
        400,
        'INVALID_FILE_SIGNATURE',
        'Uploaded text file contains binary NUL bytes and was rejected.',
      );
    }
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      controlCount++;
    }
  }
  if (controlCount / sampleLen > 0.05) {
    throw new AppError(
      400,
      'INVALID_FILE_SIGNATURE',
      'Uploaded file appears to be binary rather than UTF-8/ASCII tabular text.',
    );
  }
}

function assertExcelMagicBytes(ext: '.xlsx' | '.xls', buffer: Buffer): void {
  if (buffer.length < 8) {
    throw new AppError(400, 'INVALID_FILE_SIGNATURE', 'Uploaded Excel file is corrupted or too small.');
  }
  if (ext === '.xlsx') {
    // OOXML .xlsx files must begin with ZIP local file header PK\x03\x04
    const isZip =
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04;
    if (!isZip) {
      throw new AppError(
        400,
        'INVALID_FILE_SIGNATURE',
        'File extension is .xlsx, but file content does not match OOXML ZIP signature.',
      );
    }
  } else {
    // Legacy .xls files must begin with OLE2 Compound Binary File signature D0 CF 11 E0 A1 B1 1A E1
    const ole2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    const matchesOle2 = ole2.every((b, idx) => buffer[idx] === b);
    if (!matchesOle2) {
      throw new AppError(
        400,
        'INVALID_FILE_SIGNATURE',
        'File extension is .xls, but file content does not match OLE2 Excel signature.',
      );
    }
  }
}

const POLLUTANT_PATTERNS: Array<{ pollutant: Pollutant; regex: RegExp; defaultUnit: string }> = [
  { pollutant: 'PM25', regex: /pm\s*[_\-.]?\s*2\s*[_\-.]?\s*5|fine\s*particulate/i, defaultUnit: 'µg/m³' },
  { pollutant: 'PM10', regex: /pm\s*[_\-.]?\s*10|rspm|coarse\s*particulate/i, defaultUnit: 'µg/m³' },
  { pollutant: 'NO2', regex: /\bno\s*[_\-.]?\s*2\b|nitrogen\s*dioxide/i, defaultUnit: 'µg/m³' },
  { pollutant: 'SO2', regex: /\bso\s*[_\-.]?\s*2\b|sul[fp]hur\s*dioxide/i, defaultUnit: 'µg/m³' },
  { pollutant: 'CO', regex: /\bco\b|carbon\s*monoxide/i, defaultUnit: 'mg/m³' },
  { pollutant: 'O3', regex: /\bo\s*[_\-.]?\s*3\b|ozone/i, defaultUnit: 'µg/m³' },
  { pollutant: 'AQI', regex: /\baqi\b|air\s*quality\s*index/i, defaultUnit: 'index' },
];

function extractUnitFromHeaderOrSamples(header: string, samples: string[], fallback: string): string {
  const bracketMatch = header.match(/\(([^)]+)\)|\[([^\]]+)\]/);
  if (bracketMatch) {
    const candidate = normalizeUnitLabel(bracketMatch[1] || bracketMatch[2]);
    if (candidate !== 'unknown') return candidate;
  }
  for (const s of samples) {
    const unitMatch = s.match(/(µg\/m³|ug\/m3|µg\/m3|mg\/m³|mg\/m3|ppb|ppm)/i);
    if (unitMatch) return normalizeUnitLabel(unitMatch[1]);
  }
  return fallback;
}

function inferDateFormatHint(samples: string[]): { hint: 'auto' | 'DMY' | 'MDY' | 'ISO'; warning?: string } {
  let sawIso = false;
  let sawFirstOver12 = false;
  let sawSecondOver12 = false;
  let sawSlashDates = false;

  for (const raw of samples) {
    const s = raw.trim();
    if (!s) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      sawIso = true;
      continue;
    }
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (m) {
      sawSlashDates = true;
      const first = Number(m[1]);
      const second = Number(m[2]);
      if (first > 12) sawFirstOver12 = true;
      if (second > 12) sawSecondOver12 = true;
    }
  }

  if (sawFirstOver12 && !sawSecondOver12) return { hint: 'DMY' };
  if (sawSecondOver12 && !sawFirstOver12) return { hint: 'MDY' };
  if (sawIso && !sawSlashDates) return { hint: 'ISO' };
  if (sawSlashDates && !sawFirstOver12 && !sawSecondOver12) {
    return {
      hint: 'DMY',
      warning: 'Ambiguous DD/MM vs MM/DD dates detected. Confirm Date Format before normalizing.',
    };
  }
  return { hint: 'auto' };
}

export function detectSchemaFromRows(
  headers: string[],
  rows: Record<string, string>[],
): ServerDetectedSchema {
  const cleanHeaders = headers.map((h) => h.trim()).filter(Boolean);
  const warnings: string[] = [];

  if (cleanHeaders.length === 0 || rows.length === 0) {
    throw new AppError(400, 'EMPTY_DATASET', 'Dataset contains no recognizable columns or rows.');
  }

  const detectedColumns: ServerDetectedColumn[] = cleanHeaders.map((header) => {
    const values = rows.map((r) => String(r[header] ?? '').trim());
    const nonEmpty = values.filter((v) => v !== '' && !/^(na|n\/a|null|-|bdl)$/i.test(v));
    const missingCount = values.length - nonEmpty.length;
    const sampleValues = nonEmpty.slice(0, 5);

    let suggestedRole: ServerDetectedColumn['suggestedRole'] = 'ignore';
    let suggestedPollutant: Pollutant | undefined;
    let suggestedUnit = 'unknown';

    if (/^(loc|location|station|site|ward|area|zone|school|society)/i.test(header) || /station|location|ward|site/i.test(header)) {
      suggestedRole = 'location';
    } else if (/^(lat|latitude)$/i.test(header) || /latitude/i.test(header)) {
      suggestedRole = 'latitude';
    } else if (/^(lon|lng|long|longitude)$/i.test(header) || /longitude/i.test(header)) {
      suggestedRole = 'longitude';
    } else if (/^(time|hour)$/i.test(header)) {
      suggestedRole = 'time';
    } else if (/date|timestamp|recorded|sampled|observed/i.test(header)) {
      suggestedRole = 'timestamp';
    } else {
      for (const pat of POLLUTANT_PATTERNS) {
        if (pat.regex.test(header)) {
          suggestedRole = 'pollutant';
          suggestedPollutant = pat.pollutant;
          suggestedUnit = extractUnitFromHeaderOrSamples(header, sampleValues, pat.defaultUnit);
          break;
        }
      }
    }

    return {
      header,
      suggestedRole,
      suggestedPollutant,
      suggestedUnit,
      sampleValues,
      missingCount,
    };
  });

  const tsCol = detectedColumns.find((c) => c.suggestedRole === 'timestamp');
  const dateCheck = tsCol
    ? inferDateFormatHint(rows.slice(0, 200).map((r) => String(r[tsCol.header] ?? '')))
    : { hint: 'auto' as const };
  if (dateCheck.warning) warnings.push(dateCheck.warning);

  const missingCols = detectedColumns.filter((c) => c.missingCount > 0);
  if (missingCols.length > 0) {
    warnings.push(
      `Missing or empty readings detected in ${missingCols.length} column(s); nulls are preserved as missing.`,
    );
  }

  return {
    headers: cleanHeaders,
    detectedColumns,
    warnings,
    dateFormatHint: dateCheck.hint,
  };
}

export function parseCsvString(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const parsed = Papa.parse<Record<string, unknown>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  });

  const headers = (parsed.meta.fields || [])
    .map((h) => String(h || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 100))
    .filter(Boolean);
  if (headers.length === 0) {
    throw new AppError(400, 'PARSE_ERROR', 'Could not detect tabular header columns.');
  }
  if (headers.length > MAX_COLUMNS) {
    throw new AppError(400, 'COLUMN_LIMIT_EXCEEDED', `Maximum ${MAX_COLUMNS} columns supported per upload.`);
  }
  if (parsed.data.length > MAX_ROWS) {
    throw new AppError(400, 'ROW_LIMIT_EXCEEDED', `Maximum ${MAX_ROWS} rows supported per upload.`);
  }

  const rows = parsed.data.map((raw) => {
    const out: Record<string, string> = {};
    for (const h of headers) {
      out[h] = sanitizeSpreadsheetCell(raw[h]);
    }
    return out;
  });

  return { headers, rows };
}

export function parseExcelBuffer(buffer: Buffer): { headers: string[]; rows: Record<string, string>[] } {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    sheetRows: MAX_ROWS + 2,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
  });

  if (workbook.SheetNames.length > MAX_WORKBOOK_SHEETS) {
    throw new AppError(400, 'WORKBOOK_LIMIT_EXCEEDED', 'Uploaded Excel workbook contains too many sheets.');
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new AppError(400, 'EMPTY_WORKBOOK', 'Uploaded Excel workbook contains no sheets.');
  }

  const sheet = workbook.Sheets[sheetName];
  if (sheet && sheet['!ref']) {
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const colCount = range.e.c - range.s.c + 1;
    const rowCount = range.e.r - range.s.r + 1;
    if (colCount > MAX_COLUMNS) {
      throw new AppError(400, 'COLUMN_LIMIT_EXCEEDED', `Maximum ${MAX_COLUMNS} columns supported per upload.`);
    }
    if (rowCount > MAX_ROWS + 1) {
      throw new AppError(400, 'ROW_LIMIT_EXCEEDED', `Maximum ${MAX_ROWS} rows supported per upload.`);
    }
  }

  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });

  if (jsonRows.length === 0) {
    throw new AppError(400, 'EMPTY_WORKBOOK', 'Uploaded Excel sheet contains no data rows.');
  }
  if (jsonRows.length > MAX_ROWS) {
    throw new AppError(400, 'ROW_LIMIT_EXCEEDED', `Maximum ${MAX_ROWS} rows supported per upload.`);
  }

  const headers = Object.keys(jsonRows[0])
    .map((h) => h.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 100))
    .filter(Boolean);
  if (headers.length > MAX_COLUMNS) {
    throw new AppError(400, 'COLUMN_LIMIT_EXCEEDED', `Maximum ${MAX_COLUMNS} columns supported per upload.`);
  }

  const rows = jsonRows.map((raw) => {
    const out: Record<string, string> = {};
    for (const h of headers) {
      out[h] = sanitizeSpreadsheetCell(raw[h]);
    }
    return out;
  });

  return { headers, rows };
}

export function parseUploadedFileBuffer(
  filename: string,
  buffer: Buffer,
  titleOverride?: string,
  mimetype?: string,
): ParsedRawDataset {
  const safeFilename = sanitizeFilename(filename);
  const lower = safeFilename.toLowerCase();
  const title = titleOverride?.trim() || safeFilename.replace(/\.[^.]+$/, '') || 'Uploaded Dataset';

  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
    const ext = lower.slice(lower.lastIndexOf('.'));
    validateUploadMimeType(ext, mimetype);
    assertTextBufferIsNotBinary(buffer);
    const { headers, rows } = parseCsvString(buffer.toString('utf8'));
    return {
      title,
      sourceType: 'csv',
      originalFilename: safeFilename,
      headers,
      rows,
      detectedSchema: detectSchemaFromRows(headers, rows),
    };
  }

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const ext: '.xlsx' | '.xls' = lower.endsWith('.xlsx') ? '.xlsx' : '.xls';
    validateUploadMimeType(ext, mimetype);
    assertExcelMagicBytes(ext, buffer);
    const { headers, rows } = parseExcelBuffer(buffer);
    return {
      title,
      sourceType: 'xlsx',
      originalFilename: safeFilename,
      headers,
      rows,
      detectedSchema: detectSchemaFromRows(headers, rows),
    };
  }

  throw new AppError(
    400,
    'UNSUPPORTED_FILE_TYPE',
    'Only .csv, .tsv, .xlsx, and .xls files are supported.',
  );
}

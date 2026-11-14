import { AqiStandard, Pollutant } from '../types.ts';

export interface PollutantThreshold {
  pollutant: Pollutant;
  canonicalUnit: string;
  guidelineLimit: number;
  moderateLimit: number;
  poorLimit: number;
  severeLimit: number;
  physicalCeiling: number;
  averagingPeriod: string;
}

export const CANONICAL_UNITS: Record<Pollutant, string> = {
  PM25: 'µg/m³',
  PM10: 'µg/m³',
  NO2: 'µg/m³',
  SO2: 'µg/m³',
  O3: 'µg/m³',
  CO: 'mg/m³',
  AQI: 'index',
};

// Molecular weights (g/mol) for 25°C, 1 atm ppm/ppb <-> µg/m³ conversions (Molar volume = 24.45 L)
const MOLECULAR_WEIGHT: Partial<Record<Pollutant, number>> = {
  NO2: 46.0055,
  SO2: 64.066,
  O3: 48.0,
  CO: 28.01,
};

export const STANDARD_THRESHOLDS: Record<AqiStandard, Record<Pollutant, PollutantThreshold>> = {
  CPCB_NAQI: {
    PM25: { pollutant: 'PM25', canonicalUnit: 'µg/m³', guidelineLimit: 60, moderateLimit: 60, poorLimit: 90, severeLimit: 120, physicalCeiling: 2000, averagingPeriod: '24-hour' },
    PM10: { pollutant: 'PM10', canonicalUnit: 'µg/m³', guidelineLimit: 100, moderateLimit: 100, poorLimit: 250, severeLimit: 350, physicalCeiling: 3000, averagingPeriod: '24-hour' },
    NO2: { pollutant: 'NO2', canonicalUnit: 'µg/m³', guidelineLimit: 80, moderateLimit: 80, poorLimit: 180, severeLimit: 280, physicalCeiling: 2000, averagingPeriod: '24-hour' },
    SO2: { pollutant: 'SO2', canonicalUnit: 'µg/m³', guidelineLimit: 80, moderateLimit: 80, poorLimit: 380, severeLimit: 800, physicalCeiling: 3000, averagingPeriod: '24-hour' },
    CO: { pollutant: 'CO', canonicalUnit: 'mg/m³', guidelineLimit: 2, moderateLimit: 2, poorLimit: 10, severeLimit: 17, physicalCeiling: 100, averagingPeriod: '8-hour' },
    O3: { pollutant: 'O3', canonicalUnit: 'µg/m³', guidelineLimit: 100, moderateLimit: 100, poorLimit: 168, severeLimit: 208, physicalCeiling: 1500, averagingPeriod: '8-hour' },
    AQI: { pollutant: 'AQI', canonicalUnit: 'index', guidelineLimit: 100, moderateLimit: 100, poorLimit: 200, severeLimit: 300, physicalCeiling: 999, averagingPeriod: 'Composite' },
  },
  US_EPA: {
    PM25: { pollutant: 'PM25', canonicalUnit: 'µg/m³', guidelineLimit: 35, moderateLimit: 35.4, poorLimit: 55.4, severeLimit: 150.4, physicalCeiling: 2000, averagingPeriod: '24-hour' },
    PM10: { pollutant: 'PM10', canonicalUnit: 'µg/m³', guidelineLimit: 150, moderateLimit: 154, poorLimit: 254, severeLimit: 354, physicalCeiling: 3000, averagingPeriod: '24-hour' },
    NO2: { pollutant: 'NO2', canonicalUnit: 'µg/m³', guidelineLimit: 100, moderateLimit: 100, poorLimit: 188, severeLimit: 677, physicalCeiling: 2000, averagingPeriod: '1-hour' },
    SO2: { pollutant: 'SO2', canonicalUnit: 'µg/m³', guidelineLimit: 196, moderateLimit: 196, poorLimit: 485, severeLimit: 797, physicalCeiling: 3000, averagingPeriod: '1-hour' },
    CO: { pollutant: 'CO', canonicalUnit: 'mg/m³', guidelineLimit: 10, moderateLimit: 10.8, poorLimit: 14.2, severeLimit: 17.6, physicalCeiling: 100, averagingPeriod: '8-hour' },
    O3: { pollutant: 'O3', canonicalUnit: 'µg/m³', guidelineLimit: 137, moderateLimit: 137, poorLimit: 167, severeLimit: 206, physicalCeiling: 1500, averagingPeriod: '8-hour' },
    AQI: { pollutant: 'AQI', canonicalUnit: 'index', guidelineLimit: 100, moderateLimit: 100, poorLimit: 150, severeLimit: 200, physicalCeiling: 999, averagingPeriod: 'Composite' },
  },
  WHO_2021: {
    PM25: { pollutant: 'PM25', canonicalUnit: 'µg/m³', guidelineLimit: 15, moderateLimit: 25, poorLimit: 50, severeLimit: 75, physicalCeiling: 2000, averagingPeriod: '24-hour' },
    PM10: { pollutant: 'PM10', canonicalUnit: 'µg/m³', guidelineLimit: 45, moderateLimit: 50, poorLimit: 100, severeLimit: 150, physicalCeiling: 3000, averagingPeriod: '24-hour' },
    NO2: { pollutant: 'NO2', canonicalUnit: 'µg/m³', guidelineLimit: 25, moderateLimit: 50, poorLimit: 100, severeLimit: 200, physicalCeiling: 2000, averagingPeriod: '24-hour' },
    SO2: { pollutant: 'SO2', canonicalUnit: 'µg/m³', guidelineLimit: 40, moderateLimit: 60, poorLimit: 120, severeLimit: 250, physicalCeiling: 3000, averagingPeriod: '24-hour' },
    CO: { pollutant: 'CO', canonicalUnit: 'mg/m³', guidelineLimit: 4, moderateLimit: 7, poorLimit: 10, severeLimit: 17, physicalCeiling: 100, averagingPeriod: '24-hour' },
    O3: { pollutant: 'O3', canonicalUnit: 'µg/m³', guidelineLimit: 100, moderateLimit: 120, poorLimit: 160, severeLimit: 200, physicalCeiling: 1500, averagingPeriod: '8-hour' },
    AQI: { pollutant: 'AQI', canonicalUnit: 'index', guidelineLimit: 50, moderateLimit: 100, poorLimit: 150, severeLimit: 200, physicalCeiling: 999, averagingPeriod: 'Composite' },
  },
};

export function normalizeUnitLabel(rawUnit?: string | null): string {
  if (!rawUnit) return 'unknown';
  const cleaned = rawUnit.trim().toLowerCase().replace(/\s+/g, '');
  if (['ug/m3', 'µg/m3', 'µg/m³', 'ug/m³', 'mcg/m3', 'micrograms/m3'].includes(cleaned)) return 'µg/m³';
  if (['mg/m3', 'mg/m³', 'milligrams/m3'].includes(cleaned)) return 'mg/m³';
  if (['ppb'].includes(cleaned)) return 'ppb';
  if (['ppm'].includes(cleaned)) return 'ppm';
  if (['index', 'aqi', 'score'].includes(cleaned)) return 'index';
  return rawUnit.trim();
}

export function convertToCanonicalUnit(
  value: number,
  pollutant: Pollutant,
  sourceUnit?: string | null,
): { value: number; canonicalUnit: string; log: string | null } {
  const canonicalUnit = CANONICAL_UNITS[pollutant];
  const unit = normalizeUnitLabel(sourceUnit);

  if (pollutant === 'AQI' || unit === canonicalUnit || unit === 'unknown') {
    return {
      value,
      canonicalUnit,
      log: unit === 'unknown' ? `Assumed canonical unit ${canonicalUnit}` : null,
    };
  }

  if (pollutant === 'CO') {
    if (unit === 'µg/m³') {
      return { value: Number((value / 1000).toFixed(4)), canonicalUnit, log: 'Converted µg/m³ → mg/m³ (÷1000)' };
    }
    if (unit === 'ppm') {
      const mw = MOLECULAR_WEIGHT.CO!;
      const converted = (value * mw) / 24.45;
      return { value: Number(converted.toFixed(4)), canonicalUnit, log: 'Converted ppm → mg/m³ (25°C, 1 atm)' };
    }
    if (unit === 'ppb') {
      const mw = MOLECULAR_WEIGHT.CO!;
      const converted = (value * mw) / 24450;
      return { value: Number(converted.toFixed(4)), canonicalUnit, log: 'Converted ppb → mg/m³ (25°C, 1 atm)' };
    }
  } else {
    // Target is µg/m³
    if (unit === 'mg/m³') {
      return { value: Number((value * 1000).toFixed(3)), canonicalUnit, log: 'Converted mg/m³ → µg/m³ (×1000)' };
    }
    const mw = MOLECULAR_WEIGHT[pollutant];
    if (mw && unit === 'ppb') {
      const converted = (value * mw) / 24.45;
      return { value: Number(converted.toFixed(3)), canonicalUnit, log: `Converted ppb → µg/m³ (MW ${mw}, 25°C)` };
    }
    if (mw && unit === 'ppm') {
      const converted = (value * 1000 * mw) / 24.45;
      return { value: Number(converted.toFixed(3)), canonicalUnit, log: `Converted ppm → µg/m³ (MW ${mw}, 25°C)` };
    }
  }

  return {
    value,
    canonicalUnit,
    log: `Unrecognized unit "${sourceUnit}", retained numeric value as ${canonicalUnit}`,
  };
}

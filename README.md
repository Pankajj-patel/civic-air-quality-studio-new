# Civic Air Quality Briefing Studio

An evidence-grounded civic intelligence platform that transforms raw, inconsistent air quality datasets into normalized time-series records, deterministic hotspot analytics, stakeholder-tailored briefings, historical comparisons, PDF exports, and multilingual citizen advisories.

## Architecture Overview

- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS v4, Recharts, Leaflet
- **Backend**: Express (`server.ts`), TypeScript (`tsx`), Zod validation, `helmet`, `express-rate-limit`, `multer`, `papaparse`, `xlsx`, `pdfkit`
- **Database**: SQLite via `better-sqlite3` and Drizzle ORM (`src/db/schema.ts`, `src/db/index.ts`)
- **AI Synthesis**: Server-side `@google/genai` (`gemini-4-hydrogen`) behind a configurable `LLMProvider` abstraction (`src/server/services/ai/llmProvider.ts`), guarded by evidence-packet construction, prompt-injection sanitization, and numeric/location fact verification (`src/server/services/ai/factVerifier.ts`).

## Key Capabilities

1. **Messy Data Ingestion & Preview**: Supports CSV, TSV, Excel (`.xlsx`, `.xls`), pasted tabular data, and manual rows. Automatically detects location, date/time, coordinates, pollutants, and units with user confirmation before normalization. Preserves raw records intact.
2. **Null-Preserving Normalization & QC**: Missing values (`""`, `NA`, `BDL`, `-`, `null`) remain `NULL` (`qc_flag = 'missing'`) and are never treated as zero. Rejects negative concentrations, isolates physical sensor ceiling outliers, suppresses exact `(location, timestamp, pollutant)` duplicates, and logs unit conversions (`µg/m³`, `mg/m³`, `ppb`, `ppm`).
3. **Deterministic Analytics & Hotspots**: Calculates per-pollutant and per-station distributions (`min`, `max`, `mean`, `median`, `p95`, `stdDev`), exceedance counts against `CPCB_NAQI` (default), `US_EPA`, or `WHO_2021`, linear regression trend slopes, and composite hotspot scores with evidence traceability.
4. **Evidence-Grounded AI Briefings & Recommendations**: Generates role-scoped action plans for **Municipal Ward Officers**, **Housing Societies**, and **Schools**, distinguishing verified observations, calculated statistics, AI interpretations, and hypotheses for investigation.
5. **Multilingual Citizen Advisories**: Generates plain-language public advisories in English and Hindi (`en`, `hi`) across standard or simple reading levels.
6. **Historical Comparison & PDF Export**: Enforces a comparability gatekeeper (standard parity, shared pollutants/units, overlapping locations, <=4x window duration parity) before computing deltas, and exports formatted A4 PDF briefings via `pdfkit`.
7. **Multi-Tenant Organization RBAC & Audit Logging**: JWT session authentication (`scrypt` password hashing, `jose` HS256 tokens), organization-level tenant isolation, role permissions (`org_admin`, `ward_officer`, `housing_manager`, `school_admin`, `analyst`, `viewer`), ward location scoping, and immutable audit logs.

## Environment Variables

See `.env.example`:

- `GEMINI_API_KEY`: Server-side Gemini API key (configured via Secrets)
- `APP_URL`: Application base URL
- `SQLITE_DB_PATH`: Path to SQLite database file (default: `./data/civic_aqi.db`)
- `SESSION_SECRET`: HS256 JWT signing secret for production deployments
- `AI_PROVIDER`: Active LLM provider adapter (`gemini` default)

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Start Express + Vite dev server on port 3000
npm run lint       # Run TypeScript type checking (tsc --noEmit)
npm test           # Run unit and API integration tests
npm run build      # Build frontend production bundle into dist/
npm start          # Run production server serving dist/ and /api/*
```

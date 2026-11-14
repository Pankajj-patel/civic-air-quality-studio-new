import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { recommendations, statisticalRuns } from '../../db/schema.ts';
import { AppError } from '../middleware/errorHandler.ts';

interface EvidenceRefLike {
  locationName?: unknown;
}

interface FindingLike {
  evidenceRefs?: unknown;
}

export function extractScopedLocationsFromEvidence(
  structuredFindingsJson: string,
  recEvidenceRefsJsons: string[],
): string[] {
  const referenced = new Set<string>();

  try {
    const findings = JSON.parse(structuredFindingsJson) as FindingLike[];
    if (Array.isArray(findings)) {
      for (const f of findings) {
        if (Array.isArray(f?.evidenceRefs)) {
          for (const ref of f.evidenceRefs as EvidenceRefLike[]) {
            const loc = typeof ref?.locationName === 'string' ? ref.locationName.trim() : '';
            if (loc && loc.toLowerCase() !== 'all locations') {
              referenced.add(loc);
            }
          }
        }
      }
    }
  } catch {
    // Ignore malformed JSON; handled below
  }

  for (const jsonStr of recEvidenceRefsJsons) {
    try {
      const refs = JSON.parse(jsonStr) as EvidenceRefLike[];
      if (Array.isArray(refs)) {
        for (const ref of refs) {
          const loc = typeof ref?.locationName === 'string' ? ref.locationName.trim() : '';
          if (loc && loc.toLowerCase() !== 'all locations') {
            referenced.add(loc);
          }
        }
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  return Array.from(referenced);
}

export async function isBriefingWithinAssignedLocations(params: {
  briefingId: number;
  statisticalRunId: number;
  structuredFindingsJson: string;
  assignedLocations: string[];
}): Promise<boolean> {
  const { briefingId, statisticalRunId, structuredFindingsJson, assignedLocations } = params;
  if (assignedLocations.length === 0) {
    return true;
  }

  const allowedSet = new Set(assignedLocations);

  const recRows = await db
    .select({ evidenceRefsJson: recommendations.evidenceRefsJson })
    .from(recommendations)
    .where(eq(recommendations.briefingId, briefingId));

  const specificLocations = extractScopedLocationsFromEvidence(
    structuredFindingsJson,
    recRows.map((r) => r.evidenceRefsJson),
  );

  if (specificLocations.length > 0) {
    return specificLocations.every((loc) => allowedSet.has(loc));
  }

  // Fallback when no location-specific evidenceRefs exist: check statistical run locations
  const [run] = await db
    .select({ summaryMetricsJson: statisticalRuns.summaryMetricsJson })
    .from(statisticalRuns)
    .where(eq(statisticalRuns.id, statisticalRunId))
    .limit(1);

  if (!run) return false;
  try {
    const summary = JSON.parse(run.summaryMetricsJson) as {
      locations?: Array<{ locationName?: string }>;
    };
    const runLocs = (summary.locations || [])
      .map((l) => l.locationName?.trim() || '')
      .filter(Boolean);
    if (runLocs.length === 0) return false;
    return runLocs.every((loc) => allowedSet.has(loc));
  } catch {
    return false;
  }
}

export async function assertBriefingWithinAssignedLocations(params: {
  briefingId: number;
  statisticalRunId: number;
  structuredFindingsJson: string;
  assignedLocations: string[];
}): Promise<void> {
  const allowed = await isBriefingWithinAssignedLocations(params);
  if (!allowed) {
    throw new AppError(
      403,
      'FORBIDDEN_LOCATION_SCOPE',
      'This briefing includes monitoring locations outside your assigned jurisdiction.',
    );
  }
}

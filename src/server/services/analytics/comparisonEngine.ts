import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/index.ts';
import {
  briefingComparisons,
  briefings,
  datasets,
  hotspots,
  recommendations,
  statisticalRuns,
} from '../../../db/schema.ts';
import { AppError } from '../../middleware/errorHandler.ts';
import { assertBriefingWithinAssignedLocations } from '../../utils/locationScope.ts';
import { recordAuditLog } from '../auditService.ts';
import { LocationStatSummary, PollutantSummaryStat } from '../analytics/statsEngine.ts';

export interface ComparisonDeltaMetrics {
  pollutantDeltas: Array<{
    pollutant: string;
    unit: string;
    prevMean: number;
    currMean: number;
    deltaAbs: number;
    deltaPct: number;
    direction: 'improved' | 'deteriorated' | 'unchanged';
  }>;
  locationDeltas: Array<{
    locationName: string;
    pollutant: string;
    prevMean: number;
    currMean: number;
    deltaPct: number;
    direction: 'improved' | 'deteriorated' | 'unchanged';
  }>;
  newHotspots: string[];
  resolvedHotspots: string[];
  newlyAvailableLocations: string[];
  missingLocations: string[];
  dataQualityDelta: {
    prevCompletenessPct: number;
    currCompletenessPct: number;
    deltaPct: number;
  };
  previousRecommendations: Array<{
    id: number;
    title: string;
    urgency: string;
    status: string;
  }>;
}

export async function compareBriefings(params: {
  organizationId: number;
  userId: number;
  currentBriefingId: number;
  previousBriefingId: number;
  assignedLocations?: string[];
}) {
  const {
    organizationId,
    userId,
    currentBriefingId,
    previousBriefingId,
    assignedLocations = [],
  } = params;

  if (currentBriefingId === previousBriefingId) {
    throw new AppError(400, 'SAME_BRIEFING', 'Select two distinct briefings to compare.');
  }

  const [currBrief, prevBrief] = await Promise.all([
    db
      .select()
      .from(briefings)
      .where(and(eq(briefings.id, currentBriefingId), eq(briefings.organizationId, organizationId)))
      .limit(1)
      .then((r) => r[0]),
    db
      .select()
      .from(briefings)
      .where(and(eq(briefings.id, previousBriefingId), eq(briefings.organizationId, organizationId)))
      .limit(1)
      .then((r) => r[0]),
  ]);

  if (!currBrief || !prevBrief) {
    throw new AppError(404, 'BRIEFING_NOT_FOUND', 'One or both briefings could not be found.');
  }

  if (assignedLocations.length > 0) {
    await Promise.all([
      assertBriefingWithinAssignedLocations({
        briefingId: currBrief.id,
        statisticalRunId: currBrief.statisticalRunId,
        structuredFindingsJson: currBrief.structuredFindingsJson,
        assignedLocations,
      }),
      assertBriefingWithinAssignedLocations({
        briefingId: prevBrief.id,
        statisticalRunId: prevBrief.statisticalRunId,
        structuredFindingsJson: prevBrief.structuredFindingsJson,
        assignedLocations,
      }),
    ]);
  }

  const [currRun, prevRun, currDs, prevDs] = await Promise.all([
    db
      .select()
      .from(statisticalRuns)
      .where(eq(statisticalRuns.id, currBrief.statisticalRunId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select()
      .from(statisticalRuns)
      .where(eq(statisticalRuns.id, prevBrief.statisticalRunId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select()
      .from(datasets)
      .where(eq(datasets.id, currBrief.datasetId))
      .limit(1)
      .then((r) => r[0]),
    db
      .select()
      .from(datasets)
      .where(eq(datasets.id, prevBrief.datasetId))
      .limit(1)
      .then((r) => r[0]),
  ]);

  if (!currRun || !prevRun) {
    throw new AppError(404, 'STATS_NOT_FOUND', 'Statistical snapshots missing for comparison.');
  }

  const currSummary = JSON.parse(currRun.summaryMetricsJson) as {
    global: Record<string, PollutantSummaryStat>;
    locations: LocationStatSummary[];
  };
  const prevSummary = JSON.parse(prevRun.summaryMetricsJson) as {
    global: Record<string, PollutantSummaryStat>;
    locations: LocationStatSummary[];
  };
  if (assignedLocations.length > 0) {
    currSummary.locations = currSummary.locations.filter((l) =>
      assignedLocations.includes(l.locationName),
    );
    prevSummary.locations = prevSummary.locations.filter((l) =>
      assignedLocations.includes(l.locationName),
    );
  }
  const currQuality = JSON.parse(currRun.dataQualityReportJson) as { completenessPct: number };
  const prevQuality = JSON.parse(prevRun.dataQualityReportJson) as { completenessPct: number };

  const incomparabilityReasons: string[] = [];

  if (currBrief.datasetId === prevBrief.datasetId) {
    incomparabilityReasons.push(
      'Both briefings reference the same underlying dataset; no temporal change exists.',
    );
  }
  if (currRun.aqiStandard !== prevRun.aqiStandard) {
    incomparabilityReasons.push(
      `Threshold standard mismatch: current uses ${currRun.aqiStandard} while previous used ${prevRun.aqiStandard}.`,
    );
  }

  const currPollutants = Object.keys(currSummary.global);
  const prevPollutants = Object.keys(prevSummary.global);
  const sharedPollutants = currPollutants.filter((p) => prevPollutants.includes(p));
  if (sharedPollutants.length === 0) {
    incomparabilityReasons.push(
      'Datasets share zero common pollutants (e.g., PM2.5 vs NO2 only).',
    );
  } else {
    for (const p of sharedPollutants) {
      if (currSummary.global[p].unit !== prevSummary.global[p].unit) {
        incomparabilityReasons.push(
          `Canonical unit mismatch for ${p}: ${currSummary.global[p].unit} vs ${prevSummary.global[p].unit}.`,
        );
      }
    }
  }

  const currLocations = new Set(currSummary.locations.map((l) => l.locationName));
  const prevLocations = new Set(prevSummary.locations.map((l) => l.locationName));
  const sharedLocations = Array.from(currLocations).filter((l) => prevLocations.has(l));
  if (sharedLocations.length === 0) {
    incomparabilityReasons.push(
      'No overlapping monitoring locations exist between the two briefings.',
    );
  }

  // Time window duration parity check (> 4x span difference indicates non-comparable windows)
  if (currDs?.timeRangeStart && currDs?.timeRangeEnd && prevDs?.timeRangeStart && prevDs?.timeRangeEnd) {
    const currSpan = Math.max(
      1,
      Date.parse(currDs.timeRangeEnd) - Date.parse(currDs.timeRangeStart),
    );
    const prevSpan = Math.max(
      1,
      Date.parse(prevDs.timeRangeEnd) - Date.parse(prevDs.timeRangeStart),
    );
    const ratio = Math.max(currSpan, prevSpan) / Math.min(currSpan, prevSpan);
    if (ratio > 4) {
      incomparabilityReasons.push(
        `Observation window lengths differ substantially (${Math.round(ratio)}x span difference), which can skew exceedance and average comparisons.`,
      );
    }
  }

  const [rawCurrHotspots, rawPrevHotspots, prevRecs] = await Promise.all([
    db.select().from(hotspots).where(eq(hotspots.statisticalRunId, currRun.id)),
    db.select().from(hotspots).where(eq(hotspots.statisticalRunId, prevRun.id)),
    db.select().from(recommendations).where(eq(recommendations.briefingId, prevBrief.id)),
  ]);

  const currHotspots =
    assignedLocations.length > 0
      ? rawCurrHotspots.filter((h) => assignedLocations.includes(h.locationName))
      : rawCurrHotspots;
  const prevHotspots =
    assignedLocations.length > 0
      ? rawPrevHotspots.filter((h) => assignedLocations.includes(h.locationName))
      : rawPrevHotspots;

  const prevRecsSummary = prevRecs.map((r) => ({
    id: r.id,
    title: r.title,
    urgency: r.urgency,
    status: r.status,
  }));

  const isComparable = incomparabilityReasons.length === 0;

  let deltaMetrics: ComparisonDeltaMetrics = {
    pollutantDeltas: [],
    locationDeltas: [],
    newHotspots: [],
    resolvedHotspots: [],
    newlyAvailableLocations: Array.from(currLocations).filter((l) => !prevLocations.has(l)),
    missingLocations: Array.from(prevLocations).filter((l) => !currLocations.has(l)),
    dataQualityDelta: {
      prevCompletenessPct: prevQuality.completenessPct,
      currCompletenessPct: currQuality.completenessPct,
      deltaPct: Number((currQuality.completenessPct - prevQuality.completenessPct).toFixed(1)),
    },
    previousRecommendations: prevRecsSummary,
  };

  let summaryNarrative = '';

  if (!isComparable) {
    summaryNarrative = `Comparison withheld because the selected briefings are not directly comparable: ${incomparabilityReasons.join(' ')}`;
  } else {
    const pollutantDeltas = sharedPollutants
      .map((p) => {
        const currMean = currSummary.global[p].mean;
        const prevMean = prevSummary.global[p].mean;
        if (currMean === null || prevMean === null || prevMean === 0) return null;
        const deltaAbs = Number((currMean - prevMean).toFixed(2));
        const deltaPct = Number((((currMean - prevMean) / prevMean) * 100).toFixed(1));
        const direction: 'improved' | 'deteriorated' | 'unchanged' =
          deltaPct <= -5 ? 'improved' : deltaPct >= 5 ? 'deteriorated' : 'unchanged';
        return {
          pollutant: p,
          unit: currSummary.global[p].unit,
          prevMean,
          currMean,
          deltaAbs,
          deltaPct,
          direction,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const locationDeltas: ComparisonDeltaMetrics['locationDeltas'] = [];
    for (const locName of sharedLocations) {
      const cLoc = currSummary.locations.find((l) => l.locationName === locName);
      const pLoc = prevSummary.locations.find((l) => l.locationName === locName);
      if (!cLoc || !pLoc) continue;
      const primaryP =
        cLoc.pollutants.PM25 && pLoc.pollutants.PM25
          ? 'PM25'
          : sharedPollutants.find((p) => cLoc.pollutants[p] && pLoc.pollutants[p]);
      if (!primaryP) continue;
      const cMean = cLoc.pollutants[primaryP].mean;
      const pMean = pLoc.pollutants[primaryP].mean;
      if (cMean === null || pMean === null || pMean === 0) continue;
      const deltaPct = Number((((cMean - pMean) / pMean) * 100).toFixed(1));
      locationDeltas.push({
        locationName: locName,
        pollutant: primaryP,
        prevMean: pMean,
        currMean: cMean,
        deltaPct,
        direction: deltaPct <= -5 ? 'improved' : deltaPct >= 5 ? 'deteriorated' : 'unchanged',
      });
    }

    const activeSeverity = new Set(['critical', 'high', 'moderate']);
    const currActiveHotspots = new Set(
      currHotspots.filter((h) => activeSeverity.has(h.severity)).map((h) => h.locationName),
    );
    const prevActiveHotspots = new Set(
      prevHotspots.filter((h) => activeSeverity.has(h.severity)).map((h) => h.locationName),
    );

    const newHotspots = Array.from(currActiveHotspots).filter((l) => !prevActiveHotspots.has(l));
    const resolvedHotspots = Array.from(prevActiveHotspots).filter(
      (l) => !currActiveHotspots.has(l),
    );

    deltaMetrics = {
      ...deltaMetrics,
      pollutantDeltas,
      locationDeltas,
      newHotspots,
      resolvedHotspots,
    };

    const improvedCount = locationDeltas.filter((l) => l.direction === 'improved').length;
    const worseCount = locationDeltas.filter((l) => l.direction === 'deteriorated').length;
    const primaryDelta = pollutantDeltas[0];

    summaryNarrative = [
      primaryDelta
        ? `${primaryDelta.pollutant} changed from ${primaryDelta.prevMean} to ${primaryDelta.currMean} ${primaryDelta.unit} (${primaryDelta.deltaPct >= 0 ? '+' : ''}${primaryDelta.deltaPct}%, ${primaryDelta.direction}).`
        : 'Shared pollutant averages computed across overlapping stations.',
      `${improvedCount} overlapping location(s) improved and ${worseCount} deteriorated.`,
      newHotspots.length > 0 ? `Newly elevated hotspot(s): ${newHotspots.join(', ')}.` : '',
      resolvedHotspots.length > 0 ? `Resolved hotspot(s): ${resolvedHotspots.join(', ')}.` : '',
      `Data completeness shifted by ${deltaMetrics.dataQualityDelta.deltaPct >= 0 ? '+' : ''}${deltaMetrics.dataQualityDelta.deltaPct} percentage points.`,
    ]
      .filter(Boolean)
      .join(' ');
  }

  const saved = await db
    .insert(briefingComparisons)
    .values({
      organizationId,
      currentBriefingId,
      previousBriefingId,
      isComparable,
      incomparabilityReasonsJson: JSON.stringify(incomparabilityReasons),
      deltaMetricsJson: JSON.stringify(deltaMetrics),
      summaryNarrative,
    })
    .returning()
    .get();

  await recordAuditLog({
    organizationId,
    actorUserId: userId,
    action: 'BRIEFING_COMPARISON_RUN',
    resourceType: 'briefing_comparison',
    resourceId: saved.id,
    metadata: { currentBriefingId, previousBriefingId, isComparable },
  });

  return {
    id: saved.id,
    currentBriefingId: saved.currentBriefingId,
    previousBriefingId: saved.previousBriefingId,
    isComparable: saved.isComparable,
    incomparabilityReasons,
    deltaMetrics,
    summaryNarrative: saved.summaryNarrative,
    createdAt: saved.createdAt,
  };
}

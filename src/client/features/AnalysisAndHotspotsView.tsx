import React, { useMemo, useState } from 'react';
import { Activity, CheckCircle2, Sparkles } from 'lucide-react';
import {
  FINDING_CATEGORIES,
  FindingCategory,
  STAKEHOLDER_TYPES,
  StakeholderType,
  UserRole,
} from '../../shared/types.ts';
import { AlertBanner } from '../components/AlertBanner.tsx';
import { HotspotLeafletMap, HotspotMapPoint } from '../components/HotspotLeafletMap.tsx';
import { SegmentedTabs, TabOption } from '../components/SegmentedTabs.tsx';
import { canWriteRole, STAKEHOLDER_LABELS } from '../lib/constants.ts';
import { FullBriefingRecord } from '../types/briefings.ts';
import {
  DatasetStatsResponse,
  DatasetSummaryRecord,
  HotspotRecord,
} from '../types/datasets.ts';
import { HotspotChartSection } from './analysis/HotspotChartSection.tsx';
import { ReadingsLedgerTable } from './analysis/ReadingsLedgerTable.tsx';

interface AnalysisAndHotspotsViewProps {
  mode: 'analysis' | 'hotspots';
  userRole?: UserRole;
  datasets: DatasetSummaryRecord[];
  activeDatasetId: number | null;
  onSelectDataset: (id: number) => void;
  datasetStats: DatasetStatsResponse | null;
  hotspots: HotspotRecord[];
  activeBriefing: FullBriefingRecord | null;
  onGenerateBriefing: (stakeholder: StakeholderType) => Promise<void>;
  generatingBriefing: boolean;
  briefingProgressText?: string | null;
  aiError: string | null;
}

const CATEGORY_LABELS: Record<FindingCategory, string> = {
  verified_observation: 'Verified Observations',
  calculated_statistic: 'Calculated Statistics',
  ai_interpretation: 'AI Interpretations',
  hypothesis_for_investigation: 'Hypotheses Requiring Investigation',
};

const CATEGORY_TABS: readonly TabOption<FindingCategory>[] = FINDING_CATEGORIES.map((cat) => ({
  value: cat,
  label: CATEGORY_LABELS[cat],
}));

export const AnalysisAndHotspotsView: React.FC<AnalysisAndHotspotsViewProps> = ({
  mode,
  userRole = 'org_admin',
  datasets,
  activeDatasetId,
  onSelectDataset,
  datasetStats,
  hotspots,
  activeBriefing,
  onGenerateBriefing,
  generatingBriefing,
  briefingProgressText,
  aiError,
}) => {
  const canWrite = canWriteRole(userRole);
  const [activeCategory, setActiveCategory] = useState<FindingCategory>('verified_observation');
  const [stakeholder, setStakeholder] = useState<StakeholderType>('municipal_ward_officer');

  const mapPoints = useMemo<HotspotMapPoint[]>(() => {
    return hotspots
      .filter((h) => h.latitude !== null && h.longitude !== null)
      .map((h) => ({
        locationName: h.locationName,
        latitude: h.latitude!,
        longitude: h.longitude!,
        severity: h.severity,
        compositeScore: h.compositeScore,
        dominantPollutant: h.dominantPollutant,
        meanValue: h.meanValue,
        unit: datasetStats?.globalSummary?.[h.dominantPollutant]?.unit || 'µg/m³',
      }));
  }, [hotspots, datasetStats]);

  const chartData = useMemo(() => {
    if (!datasetStats) return [];
    return datasetStats.locationSummaries.map((loc) => {
      const primary = loc.pollutants.PM25 || Object.values(loc.pollutants)[0];
      return {
        locationName: loc.locationName,
        mean: primary?.mean ?? 0,
        p95: primary?.p95 ?? 0,
        peak: primary?.max ?? 0,
      };
    });
  }, [datasetStats]);

  const datasetSelectorBar = datasets.length > 0 && (
    <div className="flex items-center justify-between gap-4 flex-wrap bg-white border border-slate-200 rounded-xl px-5 py-3">
      <div className="flex items-center gap-3">
        <label htmlFor="analysis-dataset-select" className="text-xs font-medium text-slate-600">
          Dataset:
        </label>
        <select
          id="analysis-dataset-select"
          value={activeDatasetId ?? ''}
          onChange={(e) => onSelectDataset(Number(e.target.value))}
          className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white"
        >
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title} ({d.status})
            </option>
          ))}
        </select>
      </div>
      {datasetStats && (
        <div className="text-xs text-slate-600 font-mono tabular-nums">
          Standard: {datasetStats.aqiStandard} · Completeness:{' '}
          {datasetStats.dataQualityReport.completenessPct}%
        </div>
      )}
    </div>
  );

  if (mode === 'analysis') {
    const globalStatsList = datasetStats ? Object.values(datasetStats.globalSummary) : [];
    const findingsInTab =
      activeBriefing?.structuredFindings.filter((f) => f.category === activeCategory) ?? [];

    return (
      <div className="space-y-6">
        {datasetSelectorBar}

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Evidence-Grounded AI Data Interpretation
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Separates verified observations and calculated statistics from AI interpretations
                and hypotheses requiring field investigation.
              </p>
            </div>

            {datasetStats && (
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <label htmlFor="analysis-stakeholder-select" className="sr-only">
                  Stakeholder Persona
                </label>
                <select
                  id="analysis-stakeholder-select"
                  disabled={!canWrite}
                  value={stakeholder}
                  onChange={(e) => setStakeholder(e.target.value as StakeholderType)}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white disabled:opacity-60"
                >
                  {STAKEHOLDER_TYPES.map((st) => (
                    <option key={st} value={st}>
                      {STAKEHOLDER_LABELS[st]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={generatingBriefing || !canWrite}
                  title={
                    canWrite ? undefined : 'Read-only viewer role cannot generate AI briefings'
                  }
                  onClick={() => onGenerateBriefing(stakeholder)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  {generatingBriefing
                    ? briefingProgressText || 'Synthesizing Briefing...'
                    : 'Run AI Interpretation'}
                </button>
              </div>
            )}
          </div>

          {aiError && <AlertBanner variant="error" message={aiError} />}

          {activeBriefing && (
            <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-medium text-slate-900">
                <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" aria-hidden="true" />
                <span>
                  {activeBriefing.title} · Fact check:{' '}
                  {activeBriefing.aiMetadata.verificationPassed
                    ? 'All cited values verified'
                    : `${activeBriefing.aiMetadata.mismatchesFound.length} verification notice(s)`}
                </span>
              </div>
              <span className="font-mono text-slate-600">{activeBriefing.aiMetadata.model}</span>
            </div>
          )}

          <SegmentedTabs
            ariaLabel="Interpretation finding categories"
            options={CATEGORY_TABS}
            value={activeCategory}
            onChange={setActiveCategory}
          />

          {!datasetStats ? (
            <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center space-y-2">
              <Activity className="w-6 h-6 text-slate-500 mx-auto" aria-hidden="true" />
              <div className="text-sm font-medium text-slate-800">
                No verified statistical run found
              </div>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                Upload a dataset and confirm its column mapping in Data Preview first.
              </p>
            </div>
          ) : (
            <div role="tabpanel" aria-label={CATEGORY_LABELS[activeCategory]} className="space-y-5">
              {activeCategory === 'calculated_statistic' && (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                      <tr>
                        <th scope="col" className="py-2.5 px-3 font-medium">
                          Pollutant
                        </th>
                        <th scope="col" className="py-2.5 px-3 font-medium text-right">
                          Valid / Total
                        </th>
                        <th scope="col" className="py-2.5 px-3 font-medium text-right">
                          Mean
                        </th>
                        <th scope="col" className="py-2.5 px-3 font-medium text-right">
                          Median
                        </th>
                        <th scope="col" className="py-2.5 px-3 font-medium text-right">
                          P95
                        </th>
                        <th scope="col" className="py-2.5 px-3 font-medium text-right">
                          Max
                        </th>
                        <th scope="col" className="py-2.5 px-3 font-medium text-right">
                          Limit
                        </th>
                        <th scope="col" className="py-2.5 px-3 font-medium text-right">
                          Exceedance %
                        </th>
                        <th scope="col" className="py-2.5 px-3 font-medium">
                          Trend
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {globalStatsList.map((st) => (
                        <tr key={st.pollutant}>
                          <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                            {st.pollutant} ({st.unit})
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {st.validCount} / {st.totalCount}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {st.mean ?? '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {st.median ?? '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {st.p95 ?? '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {st.max ?? '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                            {st.guidelineLimit}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {st.exceedancePct}%
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-700">{st.trend}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {findingsInTab.length > 0 ? (
                <div className="space-y-3">
                  {findingsInTab.map((f) => (
                    <div key={f.id} className="border border-slate-200 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="text-sm font-semibold text-slate-900">{f.title}</h3>
                        <span className="text-xs text-slate-600 font-mono">
                          Confidence: {f.confidence}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed">{f.narrative}</p>
                      <div className="pt-1 text-xs text-slate-600 font-mono space-y-1">
                        {f.evidenceRefs.map((ref, idx) => (
                          <div key={idx}>
                            Source: Dataset #{ref.datasetId} · {ref.locationName}
                            {ref.pollutant ? ` · ${ref.pollutant}` : ''}
                            {ref.observedValue !== undefined && ref.observedValue !== null
                              ? ` · ${ref.observedValue} ${ref.unit || ''}`
                              : ''}
                            {ref.readingIds && ref.readingIds.length > 0
                              ? ` · Readings [${ref.readingIds.join(', ')}]`
                              : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                activeCategory !== 'calculated_statistic' && (
                  <div className="border border-dashed border-slate-300 rounded-xl p-8 text-center text-xs text-slate-600">
                    Click &ldquo;Run AI Interpretation&rdquo; above to generate{' '}
                    {CATEGORY_LABELS[activeCategory].toLowerCase()} backed by this statistical
                    snapshot.
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {datasetStats && activeDatasetId && <ReadingsLedgerTable datasetId={activeDatasetId} />}
      </div>
    );
  }

  // Hotspots Mode
  return (
    <div className="space-y-6">
      {datasetSelectorBar}

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Pollution Hotspot Identification</h2>
          <p className="text-xs text-slate-600 mt-1">
            Identifies elevated concentration zones using deterministic P95, exceedance frequency,
            mean ratio, and trend weights. Elevated readings do not assert a confirmed emission
            source.
          </p>
        </div>

        <HotspotLeafletMap points={mapPoints} />

        {hotspots.length > 0 && (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                <tr>
                  <th scope="col" className="py-2.5 px-3 font-medium">
                    Location
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-medium">
                    Severity
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-medium text-right">
                    Score
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-medium">
                    Dominant Pollutant
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-medium text-right">
                    Mean
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-medium text-right">
                    Peak
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-medium text-right">
                    Exceedance %
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hotspots.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2.5 px-3 font-medium text-slate-900">{h.locationName}</td>
                    <td className="py-2.5 px-3 font-mono font-semibold uppercase text-slate-800">
                      {h.severity}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {h.compositeScore}
                    </td>
                    <td className="py-2.5 px-3 font-mono">{h.dominantPollutant}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {h.meanValue}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {h.peakValue}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {h.exceedanceFrequencyPct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <HotspotChartSection chartData={chartData} />
    </div>
  );
};

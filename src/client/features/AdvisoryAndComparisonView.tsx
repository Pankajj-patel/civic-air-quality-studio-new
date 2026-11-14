import React, { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, CheckCircle2, GitCompare, Megaphone, Sparkles } from 'lucide-react';
import {
  READING_LEVELS,
  ReadingLevel,
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
  UserRole,
} from '../../shared/types.ts';
import { AlertBanner } from '../components/AlertBanner.tsx';
import { SegmentedTabs, TabOption } from '../components/SegmentedTabs.tsx';
import { ApiClientError, apiRequest } from '../lib/api.ts';
import { canWriteRole, LANGUAGE_LABELS, READING_LEVEL_LABELS } from '../lib/constants.ts';
import { BriefingSummaryItem, FullBriefingRecord } from '../types/briefings.ts';

interface ComparisonResult {
  id: number;
  currentBriefingId: number;
  previousBriefingId: number;
  isComparable: boolean;
  incomparabilityReasons: string[];
  summaryNarrative: string;
  deltaMetrics: {
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
  };
}

interface AdvisoryAndComparisonViewProps {
  mode: 'advisories' | 'comparisons';
  userRole?: UserRole;
  briefings: BriefingSummaryItem[];
  activeBriefing: FullBriefingRecord | null;
  onRefreshBriefing: (id: number) => Promise<void>;
}

const READING_LEVEL_TABS: readonly TabOption<ReadingLevel>[] = READING_LEVELS.map((lvl) => ({
  value: lvl,
  label: READING_LEVEL_LABELS[lvl],
}));

const LANGUAGE_TABS: readonly TabOption<SupportedLanguage>[] = SUPPORTED_LANGUAGES.map((lang) => ({
  value: lang,
  label: LANGUAGE_LABELS[lang],
}));

export const AdvisoryAndComparisonView: React.FC<AdvisoryAndComparisonViewProps> = ({
  mode,
  userRole = 'org_admin',
  briefings,
  activeBriefing,
  onRefreshBriefing,
}) => {
  const canWrite = canWriteRole(userRole);
  const [readingLevel, setReadingLevel] = useState<ReadingLevel>('simple');
  const [language, setLanguage] = useState<SupportedLanguage>('en');
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedCurrentId, setSelectedCurrentId] = useState<number>(0);
  const [selectedPrevId, setSelectedPrevId] = useState<number>(0);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);

  const validBriefingIds = new Set(briefings.map((b) => b.id));
  const defaultCurrentId =
    (activeBriefing && validBriefingIds.has(activeBriefing.id)
      ? activeBriefing.id
      : briefings[0]?.id) ?? 0;
  const currentBriefId =
    selectedCurrentId && validBriefingIds.has(selectedCurrentId)
      ? selectedCurrentId
      : defaultCurrentId;
  const fallbackPrevId =
    briefings.find((b) => b.id !== currentBriefId)?.id ?? briefings[1]?.id ?? 0;
  const previousBriefId =
    selectedPrevId && validBriefingIds.has(selectedPrevId) ? selectedPrevId : fallbackPrevId;

  async function handleGenerateAdvisory() {
    if (!activeBriefing || !canWrite) return;
    setGenerating(true);
    setErrorMsg(null);
    try {
      await apiRequest(`/api/briefings/${activeBriefing.id}/advisories`, {
        method: 'POST',
        body: JSON.stringify({
          readingLevel,
          languages: ['en', 'hi'],
        }),
      });
      await onRefreshBriefing(activeBriefing.id);
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Unable to generate advisory.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRunComparison(e: React.FormEvent) {
    e.preventDefault();
    if (!currentBriefId || !previousBriefId || !canWrite) return;
    setComparing(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{ comparison: ComparisonResult }>('/api/comparisons', {
        method: 'POST',
        body: JSON.stringify({
          currentBriefingId: currentBriefId,
          previousBriefingId: previousBriefId,
        }),
      });
      setComparison(res.comparison);
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Comparison failed.');
    } finally {
      setComparing(false);
    }
  }

  if (mode === 'advisories') {
    const matchedAdvisory = activeBriefing?.advisories.find(
      (a) => a.readingLevel === readingLevel && a.language === language,
    );

    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Multilingual Citizen Advisory Studio
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Accessible public health communication tailored by reading level without
                unsupported medical claims.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedTabs
                ariaLabel="Advisory reading level"
                options={READING_LEVEL_TABS}
                value={readingLevel}
                onChange={setReadingLevel}
              />
              <SegmentedTabs
                ariaLabel="Advisory language"
                options={LANGUAGE_TABS}
                value={language}
                onChange={setLanguage}
              />
            </div>
          </div>

          {activeBriefing && (
            <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-xs text-slate-700">
                Active Briefing: <strong className="text-slate-900">{activeBriefing.title}</strong>
              </div>
              <button
                type="button"
                disabled={generating || !canWrite}
                title={
                  canWrite ? undefined : 'Read-only viewer role cannot generate citizen advisories'
                }
                onClick={handleGenerateAdvisory}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                {generating
                  ? 'Generating EN & HI Advisories...'
                  : `Generate ${READING_LEVEL_LABELS[readingLevel]} (EN + HI)`}
              </button>
            </div>
          )}

          {errorMsg && <AlertBanner variant="error" message={errorMsg} />}

          {!activeBriefing ? (
            <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center space-y-2">
              <Megaphone className="w-6 h-6 text-slate-500 mx-auto" aria-hidden="true" />
              <div className="text-sm font-medium text-slate-800">No briefing selected</div>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                Generate an internal briefing first to produce safety-checked English and Hindi
                public advisories across all three reading levels.
              </p>
            </div>
          ) : !matchedAdvisory ? (
            <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center space-y-2">
              <Megaphone className="w-6 h-6 text-slate-500 mx-auto" aria-hidden="true" />
              <div className="text-sm font-medium text-slate-800">
                No {LANGUAGE_LABELS[language]} advisory generated for {readingLevel} reading level
              </div>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                Click the Generate button above to create synchronized English and Hindi public
                advisories for this reading level.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border border-slate-200 rounded-xl p-6 space-y-3 bg-white">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                  <span>
                    {LANGUAGE_LABELS[language]} · {READING_LEVEL_LABELS[readingLevel]}
                  </span>
                  {matchedAdvisory.safetyCheckPassed && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Safety check verified
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-semibold text-slate-900">{matchedAdvisory.headline}</h3>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {matchedAdvisory.currentConditionSummary}
                </p>
                <div className="pt-2 border-t border-slate-100 text-xs text-slate-700 leading-relaxed">
                  <strong className="text-slate-900">General Health Context: </strong>
                  {matchedAdvisory.healthGuidance}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-900">Children</div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {matchedAdvisory.childrenGuidance}
                  </p>
                </div>
                <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-900">Older Adults</div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {matchedAdvisory.olderAdultsGuidance}
                  </p>
                </div>
                <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-900">
                    Sensitive Groups (Asthma / Heart / Lung)
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {matchedAdvisory.sensitiveGroupsGuidance}
                  </p>
                </div>
                <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-900">
                    Outdoor Activity Guidance
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {matchedAdvisory.outdoorActivityGuidance}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Historical Comparisons Mode
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Previous Briefing Comparison &amp; Delta Tracking
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Validates pollutant, canonical unit, geographic, and time-window compatibility before
            computing improvement/deterioration metrics.
          </p>
        </div>

        {briefings.length < 2 ? (
          <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center space-y-2">
            <GitCompare className="w-6 h-6 text-slate-500 mx-auto" aria-hidden="true" />
            <div className="text-sm font-medium text-slate-800">
              At least two briefings are required for comparison
            </div>
            <p className="text-xs text-slate-600 max-w-md mx-auto">
              Upload a second reporting cycle dataset and generate a briefing to compare changes
              over time.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleRunComparison}
            className="p-4 rounded-lg border border-slate-200 bg-slate-50 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
          >
            <div className="md:col-span-5">
              <label
                htmlFor="compare-current-briefing"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Current Briefing
              </label>
              <select
                id="compare-current-briefing"
                value={currentBriefId}
                onChange={(e) => setSelectedCurrentId(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                {briefings.map((b) => (
                  <option key={b.id} value={b.id}>
                    #{b.id} — {b.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-5">
              <label
                htmlFor="compare-previous-briefing"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Previous Baseline Briefing
              </label>
              <select
                id="compare-previous-briefing"
                value={previousBriefId}
                onChange={(e) => setSelectedPrevId(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                {briefings.map((b) => (
                  <option key={b.id} value={b.id}>
                    #{b.id} — {b.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={comparing || !currentBriefId || !previousBriefId || !canWrite}
                title={
                  canWrite ? undefined : 'Read-only viewer role cannot create comparison records'
                }
                className="w-full px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg"
              >
                {comparing ? 'Comparing...' : 'Compare'}
              </button>
            </div>
          </form>
        )}

        {errorMsg && <AlertBanner variant="error" message={errorMsg} />}

        {comparison && (
          <div className="space-y-5">
            {!comparison.isComparable ? (
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  Datasets Not Directly Comparable
                </div>
                <p className="text-xs text-amber-900">{comparison.summaryNarrative}</p>
                <ul className="list-disc pl-5 text-xs text-amber-900 space-y-1">
                  {comparison.incomparabilityReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 leading-relaxed">
                  {comparison.summaryNarrative}
                </div>

                {comparison.deltaMetrics.pollutantDeltas.length > 0 && (
                  <div className="space-y-4">
                    <figure className="border border-slate-200 rounded-xl p-4 space-y-3">
                      <figcaption className="text-xs font-semibold text-slate-900">
                        Previous vs. Current Pollutant Means
                      </figcaption>
                      <div
                        className="h-64 w-full"
                        role="img"
                        aria-label={`Bar chart comparing previous and current mean pollutant concentrations across ${comparison.deltaMetrics.pollutantDeltas.length} pollutants.`}
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={comparison.deltaMetrics.pollutantDeltas}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                            <XAxis dataKey="pollutant" tick={{ fontSize: 11, fill: '#475569' }} />
                            <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                            <Tooltip />
                            <Bar
                              dataKey="prevMean"
                              name="Previous Mean"
                              fill="#94A3B8"
                              radius={[4, 4, 0, 0]}
                            />
                            <Bar
                              dataKey="currMean"
                              name="Current Mean"
                              fill="#0F172A"
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </figure>

                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                          <tr>
                            <th scope="col" className="py-2 px-3 font-medium">
                              Pollutant
                            </th>
                            <th scope="col" className="py-2 px-3 font-medium text-right">
                              Previous Mean
                            </th>
                            <th scope="col" className="py-2 px-3 font-medium text-right">
                              Current Mean
                            </th>
                            <th scope="col" className="py-2 px-3 font-medium text-right">
                              Delta
                            </th>
                            <th scope="col" className="py-2 px-3 font-medium">
                              Direction
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {comparison.deltaMetrics.pollutantDeltas.map((d) => (
                            <tr key={d.pollutant}>
                              <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                                {d.pollutant} ({d.unit})
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums">
                                {d.prevMean}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums">
                                {d.currMean}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums">
                                {d.deltaAbs >= 0 ? '+' : ''}
                                {d.deltaAbs} ({d.deltaPct >= 0 ? '+' : ''}
                                {d.deltaPct}%)
                              </td>
                              <td className="py-2 px-3 font-medium capitalize text-slate-800">
                                {d.direction}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="border border-slate-200 rounded-xl p-4 space-y-1">
                    <div className="font-semibold text-slate-900">New Hotspots</div>
                    <p className="text-slate-600">
                      {comparison.deltaMetrics.newHotspots.length > 0
                        ? comparison.deltaMetrics.newHotspots.join(', ')
                        : 'None'}
                    </p>
                  </div>
                  <div className="border border-slate-200 rounded-xl p-4 space-y-1">
                    <div className="font-semibold text-slate-900">Resolved Hotspots</div>
                    <p className="text-slate-600">
                      {comparison.deltaMetrics.resolvedHotspots.length > 0
                        ? comparison.deltaMetrics.resolvedHotspots.join(', ')
                        : 'None'}
                    </p>
                  </div>
                  <div className="border border-slate-200 rounded-xl p-4 space-y-1">
                    <div className="font-semibold text-slate-900">Data Completeness Delta</div>
                    <p className="font-mono tabular-nums text-slate-700">
                      {comparison.deltaMetrics.dataQualityDelta.prevCompletenessPct}% →{' '}
                      {comparison.deltaMetrics.dataQualityDelta.currCompletenessPct}% (
                      {comparison.deltaMetrics.dataQualityDelta.deltaPct >= 0 ? '+' : ''}
                      {comparison.deltaMetrics.dataQualityDelta.deltaPct}%)
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { CheckCircle2, Download, FileText, ListChecks, Search, Sparkles } from 'lucide-react';
import {
  RECOMMENDATION_STATUSES,
  RecommendationStatus,
  STAKEHOLDER_TYPES,
  StakeholderType,
  UserRole,
} from '../../shared/types.ts';
import { AlertBanner } from '../components/AlertBanner.tsx';
import { SegmentedTabs, TabOption } from '../components/SegmentedTabs.tsx';
import { ApiClientError, apiRequest, getStoredActiveOrgId, getStoredToken } from '../lib/api.ts';
import { canPublishRole, canWriteRole, STAKEHOLDER_AUTHORITY } from '../lib/constants.ts';
import { BriefingSummaryItem, FullBriefingRecord } from '../types/briefings.ts';
import { DatasetSummaryRecord } from '../types/datasets.ts';

interface RecommendationsAndBriefingsViewProps {
  mode: 'recommendations' | 'briefings';
  userRole?: UserRole;
  datasets: DatasetSummaryRecord[];
  activeDatasetId: number | null;
  briefings: BriefingSummaryItem[];
  activeBriefing: FullBriefingRecord | null;
  onSelectBriefing: (id: number) => Promise<void>;
  onGenerateBriefing: (stakeholder: StakeholderType, title?: string) => Promise<void>;
  onRefreshBriefing: (id: number) => Promise<void>;
  generating: boolean;
  briefingProgressText?: string | null;
  aiError: string | null;
}

const STAKEHOLDER_TABS: readonly TabOption<StakeholderType>[] = STAKEHOLDER_TYPES.map((type) => ({
  value: type,
  label: STAKEHOLDER_AUTHORITY[type].label,
}));

const URGENCY_TABS: readonly TabOption<'all' | 'immediate' | 'short_term' | 'medium_term'>[] = [
  { value: 'all', label: 'All Urgencies' },
  { value: 'immediate', label: 'immediate' },
  { value: 'short_term', label: 'short term' },
  { value: 'medium_term', label: 'medium term' },
];

export const RecommendationsAndBriefingsView: React.FC<RecommendationsAndBriefingsViewProps> = ({
  mode,
  userRole = 'org_admin',
  datasets,
  activeDatasetId,
  briefings,
  activeBriefing,
  onSelectBriefing,
  onGenerateBriefing,
  onRefreshBriefing,
  generating,
  briefingProgressText,
  aiError,
}) => {
  const canWrite = canWriteRole(userRole);
  const canPublish = canPublishRole(userRole);

  const [stakeholder, setStakeholder] = useState<StakeholderType>('municipal_ward_officer');
  const [customTitle, setCustomTitle] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState<
    'all' | 'immediate' | 'short_term' | 'medium_term'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const authority = STAKEHOLDER_AUTHORITY[stakeholder];
  const readyDataset = datasets.find((d) => d.id === activeDatasetId && d.status === 'ready');

  async function handleDownloadPdf() {
    if (!activeBriefing) return;
    setDownloadingPdf(true);
    setActionErr(null);
    try {
      const token = getStoredToken();
      const orgId = getStoredActiveOrgId();
      const headers = new Headers();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      if (orgId) headers.set('X-Organization-Id', String(orgId));

      const res = await fetch(`/api/briefings/${activeBriefing.id}/export/pdf`, { headers });
      if (!res.ok) {
        throw new Error('Unable to export PDF report.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `briefing-${activeBriefing.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function handleRecStatusChange(recId: number, status: RecommendationStatus) {
    if (!activeBriefing || !canPublish) return;
    setUpdatingId(recId);
    setActionErr(null);
    try {
      await apiRequest(`/api/briefings/recommendations/${recId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await onRefreshBriefing(activeBriefing.id);
    } catch (err) {
      setActionErr(err instanceof ApiClientError ? err.message : 'Unable to update status.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function handlePublishBriefing() {
    if (!activeBriefing || !canPublish) return;
    setActionErr(null);
    try {
      await apiRequest(`/api/briefings/${activeBriefing.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'published' }),
      });
      await onRefreshBriefing(activeBriefing.id);
    } catch (err) {
      setActionErr(err instanceof ApiClientError ? err.message : 'Unable to publish briefing.');
    }
  }

  if (mode === 'recommendations') {
    const filteredRecs =
      activeBriefing?.recommendations.filter((r) =>
        urgencyFilter === 'all' ? true : r.urgency === urgencyFilter,
      ) ?? [];

    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Stakeholder-Scoped Action Recommendations
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Recommendations are strictly constrained to the operational authority of the
                selected stakeholder role.
              </p>
            </div>
            <SegmentedTabs
              ariaLabel="Target stakeholder role"
              options={STAKEHOLDER_TABS}
              value={stakeholder}
              onChange={setStakeholder}
              className="self-start"
            />
          </div>

          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-900">
                Authorized Domains — {authority.label}
              </div>
              <p className="text-xs text-slate-600">{authority.scopeSummary}</p>
            </div>
            <button
              type="button"
              disabled={!readyDataset || generating || !canWrite}
              title={
                canWrite
                  ? undefined
                  : 'Read-only viewer role cannot generate stakeholder action plans'
              }
              onClick={() => onGenerateBriefing(stakeholder)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              {generating
                ? briefingProgressText || 'Generating...'
                : 'Generate Stakeholder Actions'}
            </button>
          </div>

          {(aiError || actionErr) && (
            <AlertBanner variant="error" message={(aiError || actionErr)!} />
          )}

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <SegmentedTabs
              ariaLabel="Filter recommendations by urgency"
              options={URGENCY_TABS}
              value={urgencyFilter}
              onChange={setUrgencyFilter}
            />
            {activeBriefing && (
              <div className="text-xs text-slate-600">
                Showing plan for: <strong className="text-slate-900">{activeBriefing.title}</strong>
              </div>
            )}
          </div>

          {filteredRecs.length === 0 ? (
            <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center space-y-2">
              <ListChecks className="w-6 h-6 text-slate-500 mx-auto" aria-hidden="true" />
              <div className="text-sm font-medium text-slate-800">
                No action recommendations available
              </div>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                {readyDataset
                  ? 'Click "Generate Stakeholder Actions" above to synthesize evidence-backed interventions for this dataset.'
                  : 'Normalize a dataset in Data Preview first to generate stakeholder actions.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRecs.map((rec) => (
                <div key={rec.id} className="border border-slate-200 rounded-xl p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{rec.title}</h3>
                      <div className="mt-1 text-xs text-slate-600 font-mono">
                        Impact {rec.impactScore}/5 · Urgency: {rec.urgency} · Feasibility:{' '}
                        {rec.feasibility} · Timeline: {rec.suggestedTimeline}
                      </div>
                    </div>
                    <select
                      aria-label={`Status for ${rec.title}`}
                      disabled={updatingId === rec.id || !canPublish}
                      title={
                        canPublish
                          ? undefined
                          : 'Only ward/housing/school leads or org admins can update recommendation status'
                      }
                      value={rec.status}
                      onChange={(e) =>
                        handleRecStatusChange(rec.id, e.target.value as RecommendationStatus)
                      }
                      className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-medium shrink-0 disabled:opacity-50"
                    >
                      {RECOMMENDATION_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">{rec.rationale}</p>
                  <div className="text-xs text-slate-600">
                    Responsible: <span className="text-slate-900">{rec.responsibleUnit}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Briefings & Archive Mode
  const matchingBriefings = briefings.filter((b) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      b.title.toLowerCase().includes(q) ||
      b.executiveSummary.toLowerCase().includes(q) ||
      b.stakeholderType.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Internal Briefing Notes &amp; Report Archive
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Structured administrative reports covering executive summary, pollutant evidence,
              data quality, risks, and action timelines.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {activeBriefing && activeBriefing.status !== 'published' && canPublish && (
              <button
                type="button"
                onClick={handlePublishBriefing}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg whitespace-nowrap"
              >
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                Publish Briefing
              </button>
            )}
            <button
              type="button"
              disabled={!activeBriefing || downloadingPdf}
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              {downloadingPdf ? 'Generating PDF...' : 'Export PDF Report'}
            </button>
          </div>
        </div>

        {(aiError || actionErr) && (
          <AlertBanner variant="error" message={(aiError || actionErr)!} />
        )}

        {/* Generate New Briefing Bar */}
        <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-5">
            <label
              htmlFor="briefing-title-input"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Briefing Title (optional)
            </label>
            <input
              id="briefing-title-input"
              type="text"
              disabled={!canWrite}
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="e.g., Ward 14 Weekly Air Quality Decision Note"
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white disabled:opacity-60"
            />
          </div>
          <div className="md:col-span-4">
            <label
              htmlFor="briefing-stakeholder-select"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Target Stakeholder
            </label>
            <select
              id="briefing-stakeholder-select"
              disabled={!canWrite}
              value={stakeholder}
              onChange={(e) => setStakeholder(e.target.value as StakeholderType)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white disabled:opacity-60"
            >
              {STAKEHOLDER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {STAKEHOLDER_AUTHORITY[type].label}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3">
            <button
              type="button"
              disabled={!readyDataset || generating || !canWrite}
              title={
                canWrite ? undefined : 'Read-only viewer role cannot generate internal briefings'
              }
              onClick={() => onGenerateBriefing(stakeholder, customTitle || undefined)}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg"
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
              {generating
                ? briefingProgressText || 'Generating...'
                : 'Generate Internal Briefing'}
            </button>
          </div>
        </div>

        <div className="relative">
          <label htmlFor="briefing-search-input" className="sr-only">
            Search historical briefings
          </label>
          <Search
            className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            id="briefing-search-input"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search historical briefings by title, summary, or stakeholder..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>

        {matchingBriefings.length === 0 ? (
          <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center space-y-2">
            <FileText className="w-6 h-6 text-slate-500 mx-auto" aria-hidden="true" />
            <div className="text-sm font-medium text-slate-800">No briefings generated yet</div>
            <p className="text-xs text-slate-600 max-w-md mx-auto">
              Normalize a dataset and click &ldquo;Generate Internal Briefing&rdquo; above to
              produce a full executive briefing note.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <ul
              className="lg:col-span-4 space-y-2 max-h-[540px] overflow-y-auto"
              aria-label="Briefing archive list"
            >
              {matchingBriefings.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    aria-current={activeBriefing?.id === b.id ? 'true' : undefined}
                    onClick={() => onSelectBriefing(b.id)}
                    className={`w-full text-left p-3.5 rounded-lg border transition-colors ${
                      activeBriefing?.id === b.id
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900 line-clamp-1">
                      {b.title}
                    </div>
                    <div className="mt-1 text-xs text-slate-600 font-mono">
                      {b.stakeholderType.replace(/_/g, ' ')} · {b.status}
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <div className="lg:col-span-8">
              {activeBriefing && (
                <article className="border border-slate-200 rounded-xl p-6 space-y-5 bg-white">
                  <div className="pb-4 border-b border-slate-200">
                    <div className="text-xs text-slate-600 font-mono">
                      Dataset: {activeBriefing.datasetTitle} · Stakeholder:{' '}
                      {activeBriefing.stakeholderType} · Status: {activeBriefing.status}
                    </div>
                    <h3 className="mt-1 text-lg font-semibold text-slate-900">
                      {activeBriefing.title}
                    </h3>
                  </div>

                  <section className="space-y-1.5">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Executive Summary
                    </h4>
                    <p className="text-sm text-slate-800 leading-relaxed">
                      {activeBriefing.executiveSummary}
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Key Findings &amp; Evidence
                    </h4>
                    <div className="space-y-2">
                      {activeBriefing.structuredFindings.map((f) => (
                        <div key={f.id} className="p-3 rounded-lg border border-slate-200 text-xs">
                          <div className="font-semibold text-slate-900">
                            {f.title}{' '}
                            <span className="font-mono font-normal text-slate-600">
                              ({f.category})
                            </span>
                          </div>
                          <p className="mt-1 text-slate-700 leading-relaxed">{f.narrative}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-3.5 rounded-lg border border-slate-200 space-y-1.5">
                      <h4 className="font-semibold text-slate-900">Data Quality Notes</h4>
                      <ul className="list-disc pl-4 space-y-1 text-slate-600">
                        {activeBriefing.dataQualityNotes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="p-3.5 rounded-lg border border-slate-200 space-y-1.5">
                      <h4 className="font-semibold text-slate-900">Risks &amp; Uncertainties</h4>
                      <ul className="list-disc pl-4 space-y-1 text-slate-600">
                        {activeBriefing.risksAndUncertainties.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </article>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

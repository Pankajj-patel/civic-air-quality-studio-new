import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  FileSpreadsheet,
  FileText,
  ListChecks,
  MapPin,
  Upload,
} from 'lucide-react';
import { OrganizationMembershipSummary } from '../../shared/types.ts';
import { WorkspaceSection } from '../components/LayoutShell.tsx';
import { canWriteRole } from '../lib/constants.ts';
import {
  DatasetStatsResponse,
  DatasetSummaryRecord,
  HotspotRecord,
} from '../types/datasets.ts';

interface DashboardViewProps {
  activeMembership: OrganizationMembershipSummary;
  datasets: DatasetSummaryRecord[];
  activeDataset: DatasetSummaryRecord | null;
  datasetStats: DatasetStatsResponse | null;
  hotspots: HotspotRecord[];
  onNavigate: (section: WorkspaceSection) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  activeMembership,
  datasets,
  activeDataset,
  datasetStats,
  hotspots,
  onNavigate,
}) => {
  const pm25 = datasetStats?.globalSummary?.PM25;
  const primaryMetric = pm25 || (datasetStats ? Object.values(datasetStats.globalSummary)[0] : null);
  const canWrite = canWriteRole(activeMembership.role);

  return (
    <div className="space-y-8">
      <section aria-label="Workspace KPI Summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-600">Active Standard</div>
          <div className="mt-2 text-xl font-semibold text-slate-900 font-mono tabular-nums">
            {activeMembership.defaultAqiStandard}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            Datasets stored: {datasets.length}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-600">
            {primaryMetric ? `${primaryMetric.pollutant} Mean` : 'Latest Reading Mean'}
          </div>
          <div className="mt-2 text-xl font-semibold text-slate-900 font-mono tabular-nums">
            {primaryMetric && primaryMetric.mean !== null
              ? `${primaryMetric.mean} ${primaryMetric.unit}`
              : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-600 truncate">
            {primaryMetric
              ? `Exceedance ${primaryMetric.exceedancePct}% · Trend: ${primaryMetric.trend}`
              : 'Awaiting normalized dataset'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-600">Identified Hotspots</div>
          <div className="mt-2 text-xl font-semibold text-slate-900 font-mono tabular-nums">
            {hotspots.filter((h) => h.severity === 'critical' || h.severity === 'high').length}
          </div>
          <div className="mt-1 text-xs text-slate-600 truncate">
            {hotspots.length > 0
              ? `Top zone: ${hotspots[0].locationName} (${hotspots[0].severity})`
              : 'No hotspots scored yet'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-600">Data Completeness</div>
          <div className="mt-2 text-xl font-semibold text-slate-900 font-mono tabular-nums">
            {datasetStats ? `${datasetStats.dataQualityReport.completenessPct}%` : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-600">
            {datasetStats
              ? `${datasetStats.dataQualityReport.validCount} valid / ${datasetStats.dataQualityReport.totalReadingSlots} slots`
              : 'No quality report yet'}
          </div>
        </div>
      </section>

      {!activeDataset ? (
        <section className="bg-white border border-slate-200 rounded-xl p-8">
          <div className="max-w-2xl space-y-4">
            <h2 className="text-xl font-semibold text-slate-900 text-balance">
              Begin by uploading or pasting local air quality measurements
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Civic Air Quality Briefing Studio accepts messy CSV exports, Excel spreadsheets
              (.xlsx, .xls), pasted tabular records, and manual entries. Every dataset goes through
              transparent column mapping and unit verification before statistical calculations or
              AI interpretation run.
            </p>
            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={!canWrite}
                title={canWrite ? undefined : 'Read-only viewer role cannot upload datasets'}
                onClick={() => onNavigate('upload')}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors"
              >
                <Upload className="w-4 h-4" aria-hidden="true" />
                Upload or Paste Data
              </button>
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
              >
                Configure Standards &amp; Team
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Active Dataset: {activeDataset.title}
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Status: {activeDataset.status} · {activeDataset.rowCount} rows ·{' '}
                {activeDataset.timeRangeStart
                  ? `${activeDataset.timeRangeStart.slice(0, 10)} to ${activeDataset.timeRangeEnd?.slice(0, 10)}`
                  : 'Timestamps pending'}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                onNavigate(activeDataset.status === 'ready' ? 'hotspots' : 'preview')
              }
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap shrink-0"
            >
              {activeDataset.status === 'ready' ? 'Inspect Hotspots & Stats' : 'Confirm Mapping'}
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          {datasetStats && datasetStats.dataQualityReport.warnings.length > 0 && (
            <div className="border border-amber-200 bg-amber-50/70 rounded-lg p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                Backend Data Quality Warnings
              </div>
              <ul className="text-xs text-amber-900 space-y-1 pl-6 list-disc">
                {datasetStats.dataQualityReport.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <nav aria-label="Workspace quick actions" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('preview')}
          className="text-left bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 transition-colors space-y-2"
        >
          <FileSpreadsheet className="w-5 h-5 text-slate-700" aria-hidden="true" />
          <div className="text-sm font-semibold text-slate-900">Data Preview &amp; Mapping</div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Inspect raw rows, verify pollutant units, and resolve ambiguous timestamps.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('hotspots')}
          className="text-left bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 transition-colors space-y-2"
        >
          <MapPin className="w-5 h-5 text-slate-700" aria-hidden="true" />
          <div className="text-sm font-semibold text-slate-900">Pollution Hotspots</div>
          <p className="text-xs text-slate-600 leading-relaxed">
            View station comparisons, severity scores, and geographic distribution.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('recommendations')}
          className="text-left bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 transition-colors space-y-2"
        >
          <ListChecks className="w-5 h-5 text-slate-700" aria-hidden="true" />
          <div className="text-sm font-semibold text-slate-900">Stakeholder Actions</div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Prioritized interventions scoped to Municipal Ward, Housing Society, or School roles.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('briefings')}
          className="text-left bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 transition-colors space-y-2"
        >
          <FileText className="w-5 h-5 text-slate-700" aria-hidden="true" />
          <div className="text-sm font-semibold text-slate-900">Briefings &amp; Advisories</div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Generate internal decision notes, PDF exports, and English/Hindi citizen notices.
          </p>
        </button>
      </nav>
    </div>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AlertBanner } from '../../components/AlertBanner.tsx';
import { ApiClientError, apiRequest } from '../../lib/api.ts';
import { NormalizedReadingRow } from '../../types/datasets.ts';

interface ReadingsLedgerTableProps {
  datasetId: number;
}

interface PaginatedReadingsResponse {
  readings: NormalizedReadingRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

const PAGE_SIZE = 50;

export const ReadingsLedgerTable: React.FC<ReadingsLedgerTableProps> = ({ datasetId }) => {
  const [readings, setReadings] = useState<NormalizedReadingRow[]>([]);
  const [qcFilter, setQcFilter] = useState<string>('all');
  const [offset, setOffset] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const queryKey = `${datasetId}:${qcFilter}:${offset}:${retryTick}`;
  const loading = loadedQueryKey !== queryKey;

  const loadReadings = useCallback(() => {
    setRetryTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiRequest<PaginatedReadingsResponse>(
      `/api/datasets/${datasetId}/readings?qcFlag=${encodeURIComponent(qcFilter)}&limit=${PAGE_SIZE}&offset=${offset}`,
    )
      .then((res) => {
        if (cancelled) return;
        setErrorMsg(null);
        setReadings(res.readings);
        setTotal(res.total);
        setHasMore(res.hasMore);
        setLoadedQueryKey(queryKey);
      })
      .catch((err) => {
        if (cancelled) return;
        setReadings([]);
        setTotal(0);
        setHasMore(false);
        setErrorMsg(err instanceof ApiClientError ? err.message : 'Unable to load readings ledger.');
        setLoadedQueryKey(queryKey);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, qcFilter, offset, queryKey]);

  const startRow = total === 0 ? 0 : offset + 1;
  const endRow = Math.min(offset + readings.length, total);

  return (
    <section
      aria-labelledby="readings-ledger-heading"
      className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 id="readings-ledger-heading" className="text-sm font-semibold text-slate-900">
            Normalized Readings &amp; Transformation Ledger
          </h3>
          <p className="text-xs text-slate-600">
            Audit raw-to-canonical conversions and quality flags per observation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="qc-flag-filter" className="text-xs font-medium text-slate-700">
            QC Flag:
          </label>
          <select
            id="qc-flag-filter"
            value={qcFilter}
            onChange={(e) => {
              setQcFilter(e.target.value);
              setOffset(0);
            }}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="all">All QC Flags</option>
            <option value="valid">Valid</option>
            <option value="missing">Missing (Preserved Null)</option>
            <option value="duplicate_suppressed">Duplicate Suppressed</option>
            <option value="negative_rejected">Negative Rejected</option>
            <option value="suspect_outlier">Suspect Outlier</option>
            <option value="invalid_format">Invalid Format</option>
          </select>
        </div>
      </div>

      {errorMsg && <AlertBanner variant="error" message={errorMsg} onRetry={loadReadings} />}

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
            <tr>
              <th scope="col" className="py-2 px-3 font-medium">
                Location
              </th>
              <th scope="col" className="py-2 px-3 font-medium">
                Recorded At (UTC)
              </th>
              <th scope="col" className="py-2 px-3 font-medium">
                Pollutant
              </th>
              <th scope="col" className="py-2 px-3 font-medium">
                Raw Value
              </th>
              <th scope="col" className="py-2 px-3 font-medium text-right">
                Normalized
              </th>
              <th scope="col" className="py-2 px-3 font-medium">
                QC Flag
              </th>
              <th scope="col" className="py-2 px-3 font-medium">
                Transformation Log
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-600">
                  Loading normalized readings...
                </td>
              </tr>
            ) : readings.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-600">
                  No readings match the selected QC filter.
                </td>
              </tr>
            ) : (
              readings.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 px-3 font-medium text-slate-900">{r.locationName}</td>
                  <td className="py-2 px-3 font-mono tabular-nums text-slate-600">
                    {r.recordedAt ? r.recordedAt.slice(0, 16).replace('T', ' ') : '—'}
                  </td>
                  <td className="py-2 px-3 font-mono">{r.pollutant}</td>
                  <td className="py-2 px-3 font-mono text-slate-600">
                    {r.originalValue || 'null'} {r.originalUnit || ''}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums font-medium">
                    {r.normalizedValue !== null
                      ? `${r.normalizedValue} ${r.canonicalUnit}`
                      : 'null'}
                  </td>
                  <td className="py-2 px-3 font-mono text-slate-700">{r.qcFlag}</td>
                  <td className="py-2 px-3 text-slate-600">
                    {r.transformationLog.length > 0 ? r.transformationLog.join('; ') : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-4 text-xs text-slate-600">
        <span className="font-mono tabular-nums">
          Showing {startRow}–{endRow} of {total} observations
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading || offset === 0}
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            Previous
          </button>
          <button
            type="button"
            disabled={loading || !hasMore}
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
};

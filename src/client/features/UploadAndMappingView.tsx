import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  FileSpreadsheet,
  Plus,
  Upload,
} from 'lucide-react';
import { UserRole } from '../../shared/types.ts';
import { AlertBanner } from '../components/AlertBanner.tsx';
import { SegmentedTabs, TabOption } from '../components/SegmentedTabs.tsx';
import { ApiClientError, apiRequest } from '../lib/api.ts';
import { canWriteRole, pollBackgroundJob } from '../lib/constants.ts';
import {
  DatasetPreviewResponse,
  DatasetSummaryRecord,
  ServerColumnDetection,
} from '../types/datasets.ts';
import { ColumnMappingTable } from './upload/ColumnMappingTable.tsx';
import { ManualEntryTable, ManualRow } from './upload/ManualEntryTable.tsx';

interface UploadAndMappingViewProps {
  mode: 'upload' | 'preview';
  userRole?: UserRole;
  datasets: DatasetSummaryRecord[];
  activeDatasetId: number | null;
  onSelectDataset: (id: number) => void;
  onDatasetUploaded: (preview: DatasetPreviewResponse) => Promise<void>;
  onMappingConfirmed: (datasetId: number) => Promise<void>;
  onSwitchToPreview: () => void;
}

const INPUT_TAB_OPTIONS: readonly TabOption<'file' | 'paste' | 'manual'>[] = [
  { value: 'file', label: 'CSV / Excel File' },
  { value: 'paste', label: 'Paste Table' },
  { value: 'manual', label: 'Manual Entry' },
];

export const UploadAndMappingView: React.FC<UploadAndMappingViewProps> = ({
  mode,
  userRole = 'org_admin',
  datasets,
  activeDatasetId,
  onSelectDataset,
  onDatasetUploaded,
  onMappingConfirmed,
  onSwitchToPreview,
}) => {
  const canWrite = canWriteRole(userRole);
  const [inputTab, setInputTab] = useState<'file' | 'paste' | 'manual'>('file');
  const [fileTitle, setFileTitle] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualRows, setManualRows] = useState<ManualRow[]>([
    { location: '', recordedAt: '', pm25: '', pm10: '', no2: '', latitude: '', longitude: '' },
  ]);

  const [previewData, setPreviewData] = useState<DatasetPreviewResponse | null>(null);
  const [columns, setColumns] = useState<ServerColumnDetection[]>([]);
  const [dateHint, setDateHint] = useState<'auto' | 'DMY' | 'MDY' | 'ISO'>('auto');
  const [loadedPreviewKey, setLoadedPreviewKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmProgressPct, setConfirmProgressPct] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const previewKey = mode === 'preview' && activeDatasetId ? `${mode}:${activeDatasetId}` : null;
  const loadingPreview = Boolean(previewKey && loadedPreviewKey !== previewKey);

  useEffect(() => {
    if (!previewKey || !activeDatasetId) {
      return;
    }
    let cancelled = false;
    apiRequest<DatasetPreviewResponse>(`/api/datasets/${activeDatasetId}/preview`)
      .then((res) => {
        if (cancelled) return;
        setErrorMsg(null);
        setPreviewData(res);
        setColumns(res.detectedSchema.detectedColumns);
        setDateHint(res.detectedSchema.dateFormatHint || 'auto');
        setLoadedPreviewKey(previewKey);
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(err instanceof ApiClientError ? err.message : 'Unable to load dataset preview.');
        setLoadedPreviewKey(previewKey);
      });
    return () => {
      cancelled = true;
    };
  }, [previewKey, activeDatasetId]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !canWrite) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (fileTitle.trim()) formData.append('title', fileTitle.trim());

      const res = await apiRequest<DatasetPreviewResponse>('/api/datasets/upload', {
        method: 'POST',
        body: formData,
      });
      setPreviewData(res);
      setColumns(res.detectedSchema.detectedColumns);
      setDateHint(res.detectedSchema.dateFormatHint || 'auto');
      await onDatasetUploaded(res);
      onSwitchToPreview();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Failed to upload dataset.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handlePasteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setUploading(true);
    try {
      const res = await apiRequest<DatasetPreviewResponse>('/api/datasets/upload', {
        method: 'POST',
        body: JSON.stringify({
          title: pasteTitle.trim() || 'Pasted Air Quality Table',
          sourceType: 'paste',
          rawText: pasteText,
        }),
      });
      setPreviewData(res);
      setColumns(res.detectedSchema.detectedColumns);
      setDateHint(res.detectedSchema.dateFormatHint || 'auto');
      await onDatasetUploaded(res);
      onSwitchToPreview();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Unable to parse pasted data.');
    } finally {
      setUploading(false);
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    const validRows = manualRows.filter((r) => r.location.trim() !== '');
    if (validRows.length === 0) {
      setErrorMsg('Enter at least one row with a Location / Station name.');
      return;
    }

    setUploading(true);
    try {
      const rows = validRows.map((r) => ({
        Location: r.location.trim(),
        Recorded_At: r.recordedAt.trim(),
        'PM2.5 (ug/m3)': r.pm25.trim(),
        'PM10 (ug/m3)': r.pm10.trim(),
        'NO2 (ug/m3)': r.no2.trim(),
        Latitude: r.latitude.trim(),
        Longitude: r.longitude.trim(),
      }));

      const res = await apiRequest<DatasetPreviewResponse>('/api/datasets/upload', {
        method: 'POST',
        body: JSON.stringify({
          title: manualTitle.trim() || 'Manual Air Quality Log',
          sourceType: 'manual',
          rows,
        }),
      });
      setPreviewData(res);
      setColumns(res.detectedSchema.detectedColumns);
      setDateHint(res.detectedSchema.dateFormatHint || 'auto');
      await onDatasetUploaded(res);
      onSwitchToPreview();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Unable to save manual entries.');
    } finally {
      setUploading(false);
    }
  }

  function updateColumn(index: number, patch: Partial<ServerColumnDetection>) {
    setColumns((prev) => prev.map((col, i) => (i === index ? { ...col, ...patch } : col)));
    setSuccessMsg(null);
  }

  async function handleConfirmMapping() {
    if (!previewData || !canWrite) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const locCol = columns.find((c) => c.suggestedRole === 'location');
    const tsCol = columns.find((c) => c.suggestedRole === 'timestamp');
    const timeCol = columns.find((c) => c.suggestedRole === 'time');
    const latCol = columns.find((c) => c.suggestedRole === 'latitude');
    const lonCol = columns.find((c) => c.suggestedRole === 'longitude');
    const pollutantCols = columns.filter(
      (c) => c.suggestedRole === 'pollutant' && c.suggestedPollutant,
    );

    if (!locCol || pollutantCols.length === 0) {
      setErrorMsg('Assign at least one Location column and one Pollutant column.');
      return;
    }

    setConfirming(true);
    setConfirmProgressPct(null);
    try {
      const response = await apiRequest<{ async?: boolean; jobId?: string }>(
        `/api/datasets/${previewData.dataset.id}/confirm-mapping`,
        {
          method: 'POST',
          body: JSON.stringify({
            locationColumn: locCol.header,
            timestampColumn: tsCol ? tsCol.header : null,
            timeColumn: timeCol ? timeCol.header : null,
            dateFormatHint: dateHint,
            latitudeColumn: latCol ? latCol.header : null,
            longitudeColumn: lonCol ? lonCol.header : null,
            pollutantColumns: pollutantCols.map((c) => ({
              sourceColumn: c.header,
              pollutant: c.suggestedPollutant!,
              sourceUnit: c.suggestedUnit || 'unknown',
            })),
          }),
        },
      );

      if (response.async && response.jobId) {
        setConfirmProgressPct(10);
        await pollBackgroundJob(response.jobId, {
          onProgress: (job) => setConfirmProgressPct(job.progressPct),
        });
      }

      await onMappingConfirmed(previewData.dataset.id);
      setSuccessMsg(
        'Dataset normalized, unit-converted, and statistically analyzed. View Hotspots or AI Analysis.',
      );
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : 'Normalization failed.',
      );
    } finally {
      setConfirming(false);
      setConfirmProgressPct(null);
    }
  }

  if (mode === 'upload') {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Ingest Air Quality Dataset</h2>
              <p className="text-xs text-slate-600 mt-1">
                Original values are stored verbatim in SQLite. Missing cells remain null and all
                unit conversions are logged before statistical analysis.
              </p>
            </div>
            <SegmentedTabs
              ariaLabel="Dataset ingestion method"
              options={INPUT_TAB_OPTIONS}
              value={inputTab}
              onChange={(next) => {
                setInputTab(next);
                setErrorMsg(null);
              }}
              className="self-start"
            />
          </div>

          {!canWrite && (
            <AlertBanner
              variant="info"
              message="Your current role (viewer) has read-only access and cannot upload datasets."
            />
          )}

          {errorMsg && <AlertBanner variant="error" message={errorMsg} />}

          {inputTab === 'file' && (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="file-dataset-title"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Dataset Title (optional — defaults to filename)
                </label>
                <input
                  id="file-dataset-title"
                  type="text"
                  disabled={!canWrite}
                  value={fileTitle}
                  onChange={(e) => setFileTitle(e.target.value)}
                  placeholder="e.g., Ward 14 November Monitoring Export"
                  className="w-full max-w-md px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                />
              </div>
              <label
                htmlFor="file-upload-input"
                className={`block border-2 border-dashed border-slate-300 hover:border-slate-400 focus-within:ring-2 focus-within:ring-teal-600 focus-within:border-teal-600 rounded-xl p-10 text-center transition-colors bg-slate-50/50 ${
                  canWrite ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'
                }`}
              >
                <input
                  id="file-upload-input"
                  type="file"
                  accept=".csv,.xlsx,.xls,.tsv"
                  onChange={handleFileSelect}
                  disabled={uploading || !canWrite}
                  className="sr-only"
                />
                <Upload className="w-7 h-7 text-slate-600 mx-auto mb-3" aria-hidden="true" />
                <div className="text-sm font-medium text-slate-900">
                  {uploading
                    ? 'Uploading and analyzing columns...'
                    : 'Select a .csv, .xlsx, or .xls file'}
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Max 10MB · Handles inconsistent headers, mixed date formats, blank cells, and
                  µg/m³ / mg/m³ / ppb / ppm units.
                </p>
              </label>
            </div>
          )}

          {inputTab === 'paste' && (
            <form onSubmit={handlePasteSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="paste-dataset-title"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Dataset Title
                </label>
                <input
                  id="paste-dataset-title"
                  type="text"
                  required
                  disabled={!canWrite}
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="e.g., Ward 14 Weekly Station Readings"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                />
              </div>
              <div>
                <label
                  htmlFor="paste-raw-text"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Paste CSV or Tab-Separated Table (include header row)
                </label>
                <textarea
                  id="paste-raw-text"
                  rows={8}
                  required
                  disabled={!canWrite}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={'Station,Date,PM2.5 (ug/m3),PM10,NO2\nWard 14 Gate,2026-11-10,118,195,42'}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                />
              </div>
              <button
                type="submit"
                disabled={uploading || !canWrite}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
              >
                <ClipboardPaste className="w-4 h-4" aria-hidden="true" />
                {uploading ? 'Uploading...' : 'Upload & Preview Mapping'}
              </button>
            </form>
          )}

          {inputTab === 'manual' && (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="manual-dataset-title"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Dataset Title
                </label>
                <input
                  id="manual-dataset-title"
                  type="text"
                  required
                  disabled={!canWrite}
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="e.g., Campus Morning Checkpoints"
                  className="w-full max-w-md px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:bg-slate-50"
                />
              </div>

              <ManualEntryTable
                rows={manualRows}
                onChangeRow={(idx, patch) =>
                  setManualRows((prev) =>
                    prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
                  )
                }
                onRemoveRow={(idx) =>
                  setManualRows((prev) => prev.filter((_, i) => i !== idx))
                }
              />

              <div className="flex items-center justify-between gap-4">
                <button
                  type="button"
                  disabled={!canWrite}
                  onClick={() =>
                    setManualRows((prev) => [
                      ...prev,
                      {
                        location: '',
                        recordedAt: '',
                        pm25: '',
                        pm10: '',
                        no2: '',
                        latitude: '',
                        longitude: '',
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  Add Row
                </button>
                <button
                  type="submit"
                  disabled={uploading || !canWrite}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
                >
                  {uploading ? 'Saving...' : 'Save & Preview Mapping'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Preview & Validation Mode
  if (datasets.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
        <FileSpreadsheet className="w-7 h-7 text-slate-500 mx-auto" aria-hidden="true" />
        <h2 className="text-base font-semibold text-slate-900">No datasets uploaded yet</h2>
        <p className="text-xs text-slate-600 max-w-md mx-auto">
          Upload a CSV or Excel file, paste tabular data, or enter manual readings first to
          inspect auto-detected columns and run server normalization.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <label htmlFor="preview-dataset-select" className="text-xs font-medium text-slate-600">
                Dataset:
              </label>
              <select
                id="preview-dataset-select"
                value={activeDatasetId ?? ''}
                onChange={(e) => onSelectDataset(Number(e.target.value))}
                className="px-3 py-1.5 text-sm font-medium border border-slate-300 rounded-lg bg-white"
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} ({d.rowCount} rows · {d.status})
                  </option>
                ))}
              </select>
            </div>
            {previewData && (
              <p className="text-xs text-slate-600">
                Source: {previewData.dataset.sourceType.toUpperCase()} · {previewData.dataset.rowCount}{' '}
                rows · {previewData.detectedSchema.headers.length} columns
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            <label htmlFor="date-format-hint" className="sr-only">
              Date Format Hint
            </label>
            <select
              id="date-format-hint"
              disabled={!canWrite}
              value={dateHint}
              onChange={(e) => setDateHint(e.target.value as 'auto' | 'DMY' | 'MDY' | 'ISO')}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white disabled:opacity-60"
            >
              <option value="auto">Date Format: Auto</option>
              <option value="DMY">Date Format: DD/MM/YYYY</option>
              <option value="MDY">Date Format: MM/DD/YYYY</option>
              <option value="ISO">Date Format: ISO-8601</option>
            </select>
            <button
              type="button"
              disabled={confirming || !previewData || !canWrite}
              title={
                canWrite
                  ? undefined
                  : 'Read-only viewer role cannot confirm mapping or normalize datasets'
              }
              onClick={handleConfirmMapping}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              {confirming
                ? confirmProgressPct !== null
                  ? `Normalizing (${confirmProgressPct}%)...`
                  : 'Normalizing & Analyzing...'
                : 'Confirm & Normalize Dataset'}
            </button>
          </div>
        </div>

        {errorMsg && <AlertBanner variant="error" message={errorMsg} />}
        {successMsg && <AlertBanner variant="success" message={successMsg} />}

        {loadingPreview ? (
          <div role="status" className="py-8 text-center text-xs text-slate-600">
            Loading preview...
          </div>
        ) : (
          previewData && (
            <>
              {previewData.detectedSchema.warnings.length > 0 && (
                <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/70 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                    <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    Ingestion Warnings
                  </div>
                  <ul className="text-xs text-amber-900 pl-6 list-disc space-y-0.5">
                    {previewData.detectedSchema.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <ColumnMappingTable
                columns={columns}
                disabled={!canWrite}
                onUpdateColumn={updateColumn}
              />
            </>
          )
        )}
      </div>

      {previewData && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Preserved Raw Records (First {previewData.previewRows.length} of{' '}
            {previewData.dataset.rowCount} Rows)
          </h3>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                <tr>
                  <th scope="col" className="py-2 px-3 font-medium w-12">
                    #
                  </th>
                  {previewData.detectedSchema.headers.map((h) => (
                    <th key={h} scope="col" className="py-2 px-3 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewData.previewRows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3 font-mono tabular-nums text-slate-600">{rIdx + 1}</td>
                    {previewData.detectedSchema.headers.map((h) => (
                      <td
                        key={h}
                        className="py-2 px-3 font-mono tabular-nums text-slate-800 whitespace-nowrap"
                      >
                        {row[h] === '' ? (
                          <span className="text-slate-600 italic">null</span>
                        ) : (
                          row[h]
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

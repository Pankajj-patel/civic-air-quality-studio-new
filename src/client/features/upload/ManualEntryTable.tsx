import React from 'react';
import { Trash2 } from 'lucide-react';

export interface ManualRow {
  location: string;
  recordedAt: string;
  pm25: string;
  pm10: string;
  no2: string;
  latitude: string;
  longitude: string;
}

interface ManualEntryTableProps {
  rows: ManualRow[];
  onChangeRow: (index: number, patch: Partial<ManualRow>) => void;
  onRemoveRow: (index: number) => void;
}

export const ManualEntryTable: React.FC<ManualEntryTableProps> = ({
  rows,
  onChangeRow,
  onRemoveRow,
}) => {
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="w-full text-left border-collapse text-xs">
        <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
          <tr>
            <th scope="col" className="py-2.5 px-3 font-medium">
              Location / Station
            </th>
            <th scope="col" className="py-2.5 px-3 font-medium">
              Timestamp
            </th>
            <th scope="col" className="py-2.5 px-3 font-medium">
              PM2.5 (µg/m³)
            </th>
            <th scope="col" className="py-2.5 px-3 font-medium">
              PM10 (µg/m³)
            </th>
            <th scope="col" className="py-2.5 px-3 font-medium">
              NO2 (µg/m³)
            </th>
            <th scope="col" className="py-2.5 px-3 font-medium">
              Lat
            </th>
            <th scope="col" className="py-2.5 px-3 font-medium">
              Lon
            </th>
            <th scope="col" className="py-2.5 px-3 font-medium w-10">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, idx) => (
            <tr key={idx}>
              <td className="p-2">
                <input
                  type="text"
                  required
                  aria-label={`Row ${idx + 1} Location or Station`}
                  value={row.location}
                  onChange={(e) => onChangeRow(idx, { location: e.target.value })}
                  placeholder="Main Gate"
                  className="w-full px-2 py-1.5 border border-slate-300 rounded"
                />
              </td>
              <td className="p-2">
                <input
                  type="text"
                  aria-label={`Row ${idx + 1} Timestamp`}
                  value={row.recordedAt}
                  onChange={(e) => onChangeRow(idx, { recordedAt: e.target.value })}
                  placeholder="2026-11-13 09:00"
                  className="w-full px-2 py-1.5 border border-slate-300 rounded font-mono"
                />
              </td>
              <td className="p-2">
                <input
                  type="text"
                  aria-label={`Row ${idx + 1} PM2.5 (µg/m³)`}
                  value={row.pm25}
                  onChange={(e) => onChangeRow(idx, { pm25: e.target.value })}
                  placeholder="84.5"
                  className="w-24 px-2 py-1.5 border border-slate-300 rounded font-mono tabular-nums"
                />
              </td>
              <td className="p-2">
                <input
                  type="text"
                  aria-label={`Row ${idx + 1} PM10 (µg/m³)`}
                  value={row.pm10}
                  onChange={(e) => onChangeRow(idx, { pm10: e.target.value })}
                  placeholder="142"
                  className="w-24 px-2 py-1.5 border border-slate-300 rounded font-mono tabular-nums"
                />
              </td>
              <td className="p-2">
                <input
                  type="text"
                  aria-label={`Row ${idx + 1} NO2 (µg/m³)`}
                  value={row.no2}
                  onChange={(e) => onChangeRow(idx, { no2: e.target.value })}
                  placeholder="38"
                  className="w-24 px-2 py-1.5 border border-slate-300 rounded font-mono tabular-nums"
                />
              </td>
              <td className="p-2">
                <input
                  type="text"
                  aria-label={`Row ${idx + 1} Latitude`}
                  value={row.latitude}
                  onChange={(e) => onChangeRow(idx, { latitude: e.target.value })}
                  placeholder="28.6139"
                  className="w-24 px-2 py-1.5 border border-slate-300 rounded font-mono tabular-nums"
                />
              </td>
              <td className="p-2">
                <input
                  type="text"
                  aria-label={`Row ${idx + 1} Longitude`}
                  value={row.longitude}
                  onChange={(e) => onChangeRow(idx, { longitude: e.target.value })}
                  placeholder="77.2090"
                  className="w-24 px-2 py-1.5 border border-slate-300 rounded font-mono tabular-nums"
                />
              </td>
              <td className="p-2 text-center">
                <button
                  type="button"
                  disabled={rows.length <= 1}
                  onClick={() => onRemoveRow(idx)}
                  aria-label={`Remove row ${idx + 1}`}
                  className="p-1 text-slate-600 hover:text-red-700 disabled:opacity-30 rounded"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

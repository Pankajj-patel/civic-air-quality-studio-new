import React from 'react';
import { POLLUTANTS, Pollutant } from '../../../shared/types.ts';
import { UNIT_OPTIONS } from '../../lib/constants.ts';
import { ServerColumnDetection } from '../../types/datasets.ts';

interface ColumnMappingTableProps {
  columns: ServerColumnDetection[];
  disabled?: boolean;
  onUpdateColumn: (index: number, patch: Partial<ServerColumnDetection>) => void;
}

export const ColumnMappingTable: React.FC<ColumnMappingTableProps> = ({
  columns,
  disabled = false,
  onUpdateColumn,
}) => {
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-lg">
      <table className="w-full text-left border-collapse text-xs">
        <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
          <tr>
            <th scope="col" className="py-2.5 px-3 font-medium">
              Source Header
            </th>
            <th scope="col" className="py-2.5 px-3 font-medium">
              Role
            </th>
            <th scope="col" className="py-2.5 px-3 font-medium">
              Pollutant
            </th>
            <th scope="col" className="py-2.5 px-3 font-medium">
              Source Unit
            </th>
            <th scope="col" className="py-2.5 px-3 font-medium text-right">
              Missing
            </th>
            <th scope="col" className="py-2.5 px-3 font-medium">
              Sample Values
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {columns.map((col, idx) => (
            <tr key={col.header} className="hover:bg-slate-50/70">
              <td className="py-2.5 px-3 font-medium text-slate-900 font-mono">{col.header}</td>
              <td className="py-2.5 px-3">
                <select
                  disabled={disabled}
                  aria-label={`Column role for ${col.header}`}
                  value={col.suggestedRole}
                  onChange={(e) =>
                    onUpdateColumn(idx, {
                      suggestedRole: e.target.value as ServerColumnDetection['suggestedRole'],
                    })
                  }
                  className="px-2 py-1 border border-slate-300 rounded bg-white disabled:opacity-60"
                >
                  <option value="location">Location / Station</option>
                  <option value="timestamp">Date / Timestamp</option>
                  <option value="time">Time Only</option>
                  <option value="latitude">Latitude</option>
                  <option value="longitude">Longitude</option>
                  <option value="pollutant">Pollutant Reading</option>
                  <option value="ignore">Ignore Column</option>
                </select>
              </td>
              <td className="py-2.5 px-3">
                {col.suggestedRole === 'pollutant' ? (
                  <select
                    disabled={disabled}
                    aria-label={`Pollutant type for ${col.header}`}
                    value={col.suggestedPollutant || 'PM25'}
                    onChange={(e) =>
                      onUpdateColumn(idx, {
                        suggestedPollutant: e.target.value as Pollutant,
                      })
                    }
                    className="px-2 py-1 border border-slate-300 rounded bg-white font-mono disabled:opacity-60"
                  >
                    {POLLUTANTS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
              <td className="py-2.5 px-3">
                {col.suggestedRole === 'pollutant' ? (
                  <select
                    disabled={disabled}
                    aria-label={`Source unit for ${col.header}`}
                    value={col.suggestedUnit}
                    onChange={(e) => onUpdateColumn(idx, { suggestedUnit: e.target.value })}
                    className="px-2 py-1 border border-slate-300 rounded bg-white disabled:opacity-60"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
              <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                {col.missingCount}
              </td>
              <td className="py-2.5 px-3 text-slate-600 font-mono truncate max-w-xs">
                {col.sampleValues.length > 0 ? col.sampleValues.join(', ') : 'Empty'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

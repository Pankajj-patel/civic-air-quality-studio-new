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
import { AlertCircle, MapPin, Table2 } from 'lucide-react';

export interface LocationChartPoint {
  locationName: string;
  mean: number;
  p95: number;
  peak: number;
}

interface HotspotChartSectionProps {
  chartData: LocationChartPoint[];
}

export const HotspotChartSection: React.FC<HotspotChartSectionProps> = ({ chartData }) => {
  const [showTable, setShowTable] = useState(false);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <figure className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <figcaption className="text-sm font-semibold text-slate-900">
            Comparative Location Concentrations
          </figcaption>
          {chartData.length > 0 && (
            <button
              type="button"
              aria-expanded={showTable}
              onClick={() => setShowTable((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              <Table2 className="w-3.5 h-3.5" aria-hidden="true" />
              {showTable ? 'View Chart' : 'View Data Table'}
            </button>
          )}
        </div>

        {chartData.length === 0 ? (
          <div className="h-64 border border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center p-6 text-center">
            <MapPin className="w-6 h-6 text-slate-500 mb-2" aria-hidden="true" />
            <p className="text-xs text-slate-600 max-w-sm">
              Confirm a dataset mapping to inspect comparative pollutant concentrations across
              monitoring locations.
            </p>
          </div>
        ) : showTable ? (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                <tr>
                  <th scope="col" className="py-2 px-3 font-medium">
                    Location
                  </th>
                  <th scope="col" className="py-2 px-3 font-medium text-right">
                    Mean
                  </th>
                  <th scope="col" className="py-2 px-3 font-medium text-right">
                    P95
                  </th>
                  <th scope="col" className="py-2 px-3 font-medium text-right">
                    Peak
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {chartData.map((row) => (
                  <tr key={row.locationName}>
                    <td className="py-2 px-3 font-medium text-slate-900">{row.locationName}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{row.mean}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{row.p95}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{row.peak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div
              className="h-64 w-full"
              role="img"
              aria-label={`Bar chart comparing Mean, P95, and Peak concentrations across ${chartData.length} monitoring locations.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="locationName" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip />
                  <Bar dataKey="mean" name="Mean" fill="#0F172A" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="p95" name="P95" fill="#0D9488" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="peak" name="Peak" fill="#D97706" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Screen-reader accessible summary table */}
            <table className="sr-only">
              <caption>Comparative concentration values by location</caption>
              <thead>
                <tr>
                  <th scope="col">Location</th>
                  <th scope="col">Mean</th>
                  <th scope="col">P95</th>
                  <th scope="col">Peak</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map((row) => (
                  <tr key={row.locationName}>
                    <td>{row.locationName}</td>
                    <td>{row.mean}</td>
                    <td>{row.p95}</td>
                    <td>{row.peak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </figure>

      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-900">Hotspot Methodology</h3>
        <ul className="text-xs text-slate-600 space-y-2 leading-relaxed">
          <li>
            <strong className="text-slate-900">40% P95 Concentration:</strong> Captures sustained
            high-exposure peaks relative to the active standard.
          </li>
          <li>
            <strong className="text-slate-900">35% Exceedance Frequency:</strong> Share of valid
            readings exceeding the guideline threshold.
          </li>
          <li>
            <strong className="text-slate-900">15% Mean Ratio:</strong> Baseline concentration burden
            across valid records.
          </li>
          <li>
            <strong className="text-slate-900">10% Trend Penalty:</strong> Applied only when valid
            coverage meets statistical minimums (&ge; 50%).
          </li>
        </ul>
        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Locations with &lt; 30% valid data completeness are automatically downgraded to
            low-confidence watch status.
          </span>
        </div>
      </div>
    </div>
  );
};

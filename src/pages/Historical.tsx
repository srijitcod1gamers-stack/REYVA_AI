import { useEffect, useState } from 'react';
import type { ScalarGrid } from '../../shared/types';
import { GridMap } from '../components/map/GridMap';
import { PageHeading } from '../components/ui/Primitives';
import { download } from '../utils/format';

export interface HistoricalCase {
  id: string;
  hour: number;
  initialization: string;
  valid_time: string;
  source: string;
  forecast: ScalarGrid;
  observation: ScalarGrid;
  interpolation: ScalarGrid;
  metrics: { mae_mm: number; rmse_mm: number; observed_cells: number; scope: string };
  resolution_degrees: { forecast: number; observation: number };
  note: string;
}
export const apiBase = import.meta.env.VITE_API_BASE_URL || '/api';
export async function datasetRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiBase + path, { signal: signal ?? AbortSignal.timeout(30000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || body.error || `Dataset returned ${response.status}`);
  return body as T;
}
export default function Historical({ lab = false }: { lab?: boolean }) {
  const [cases, setCases] = useState<{ id: string; name: string; valid_time: string }[]>([]);
  const [id, setId] = useState('');
  const [data, setData] = useState<HistoricalCase | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'forecast' | 'observation' | 'interpolation'>('forecast');
  useEffect(() => {
    const c = new AbortController();
    datasetRequest<{ cases: typeof cases }>('/replay', c.signal)
      .then((result) => {
        setCases(result.cases);
        setId(result.cases[0]?.id ?? '');
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  useEffect(() => {
    if (!id) return;
    const c = new AbortController();
    setData(null);
    setError('');
    datasetRequest<HistoricalCase>(`/replay/${id}`, c.signal)
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [id]);
  return (
    <div className="page dataset-page">
      <PageHeading
        eyebrow="PREPARED NOAA GEFS + CHIRPS DATA"
        title={lab ? 'Forecast verification workspace' : 'Historical case explorer'}
        description={
          lab
            ? 'Compare coarse forecasts, 5 km observations and interpolation using the downloaded verification cases.'
            : 'Inspect actual historical forecast and observation grids for the prepared cyclone verification windows.'
        }
      />
      <div className="dataset-toolbar panel">
        <label>
          Historical case{' '}
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {!lab && (
          <label>
            Weather layer{' '}
            <select value={view} onChange={(e) => setView(e.target.value as typeof view)}>
              <option value="forecast">GEFS forecast</option>
              <option value="observation">CHIRPS 5 km observations</option>
              <option value="interpolation">5 km interpolation</option>
            </select>
          </label>
        )}
        {data && (
          <button className="secondary-button" onClick={() => download(`${id}-verification.json`, data)}>
            Export real case
          </button>
        )}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {!data && !error && <div className="panel dataset-loading">Loading prepared grids…</div>}
      {data && (
        <>
          <div className="dataset-metrics">
            <div className="panel">
              <small>Forecast initialized</small>
              <strong>
                {new Date(data.initialization).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC
              </strong>
            </div>
            <div className="panel">
              <small>24-hour rainfall ending</small>
              <strong>
                {new Date(data.valid_time).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC
              </strong>
            </div>
            <div className="panel">
              <small>Interpolation MAE / RMSE</small>
              <strong>
                {data.metrics.mae_mm} / {data.metrics.rmse_mm} mm
              </strong>
            </div>
            <div className="panel">
              <small>Observed land cells evaluated</small>
              <strong>{data.metrics.observed_cells.toLocaleString()}</strong>
            </div>
          </div>
          {lab ? (
            <div className="dataset-comparison">
              <section className="panel">
                <h3>Native GEFS forecast · {data.resolution_degrees.forecast}°</h3>
                <GridMap grid={data.forecast} label="NOAA reforecast · mm/24h" />
              </section>
              <section className="panel">
                <h3>CHIRPS reference · 0.05°</h3>
                <GridMap grid={data.observation} label="OBSERVED land rainfall · mm/24h" />
              </section>
              <section className="panel">
                <h3>Interpolation baseline · 0.05°</h3>
                <GridMap grid={data.interpolation} label="INTERPOLATED forecast · mm/24h" />
              </section>
            </div>
          ) : (
            <section className="panel">
              <GridMap grid={data[view]} label={`${view.toUpperCase()} · mm/24h`} />
            </section>
          )}
          <div className="panel info-note">
            {data.note}. Lead: T+{data.hour}h. {data.source}. Ocean observation cells remain masked. The
            5 km reference is observed rainfall; interpolation is a baseline, and neither is labelled as
            AI output.
          </div>
        </>
      )}
    </div>
  );
}

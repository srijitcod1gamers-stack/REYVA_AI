import { lazy, Suspense, useEffect, useState } from 'react';
import { Check, Download, FlaskConical, Link2, MoveHorizontal } from 'lucide-react';
import { provider } from '../services/weather';
import type { DownscalingResult } from '../../shared/types';
import { physicsMetrics } from '../../shared/fixtures';
import { DemoTag, PageHeading, SectionLabel } from '../components/ui/Primitives';
import { download } from '../utils/format';
const MapCanvas = lazy(() => import('../components/map/MapCanvas'));
export default function Downscaling() {
  const [data, setData] = useState<DownscalingResult[]>([]),
    [error, setError] = useState(''),
    [compare, setCompare] = useState<'ai' | 'interpolation'>('ai'),
    [synced, setSynced] = useState(true),
    [view, setView] = useState<{ lng: number; lat: number; zoom: number }>();
  useEffect(() => {
    const controller = new AbortController();
    provider
      .getDownscaling(controller.signal)
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="page downscaling-page">
      <PageHeading
        eyebrow="RESOLUTION THAT REVEALS"
        title="AI downscaling lab"
        description="Explore how finer spatial structure changes the picture of an extreme event."
        actions={
          <>
            <DemoTag>DEMO · NOT VALIDATED</DemoTag>
            <button
              className="secondary-button"
              onClick={() => download('downscaling-demo-comparison.json', data)}
            >
              <Download size={14} /> Export comparison
            </button>
          </>
        }
      />
      <div className="lab-toolbar">
        <div className="segment-control">
          <button
            className={compare === 'interpolation' ? 'active' : ''}
            onClick={() => setCompare('interpolation')}
          >
            5 km interpolation
          </button>
          <button className={compare === 'ai' ? 'active' : ''} onClick={() => setCompare('ai')}>
            <FlaskConical size={14} /> 5 km AI downscaled
          </button>
        </div>
        <button
          className={`secondary-button ${synced ? 'mint' : ''}`}
          onClick={() => setSynced(!synced)}
        >
          <Link2 size={14} />
          {synced ? 'Views synchronized' : 'Independent views'}
        </button>
      </div>
      <div className="comparison-maps">
        <div className="comparison-map panel">
          <div className="comparison-map-title">
            <div>
              <span className="eyebrow">MODEL INPUT</span>
              <h3>Original forecast</h3>
            </div>
            <b>
              12 <small>km</small>
            </b>
          </div>
          <Suspense fallback={<div className="loading-line" />}>
            <MapCanvas
              compact
              resolution={12}
              syncView={synced ? view : undefined}
              onViewChange={synced ? setView : undefined}
            />
          </Suspense>
          <span className="map-data-tag">SIMULATED COARSE GRID</span>
        </div>
        <div className="comparison-map panel">
          <div className="comparison-map-title">
            <div>
              <span className="eyebrow mint">
                {compare === 'ai' ? 'CONDITIONAL DIFFUSION · DEMO' : 'BILINEAR RESAMPLING · DEMO'}
              </span>
              <h3>{compare === 'ai' ? 'AI downscaled' : 'Interpolated field'}</h3>
            </div>
            <b className="mint">
              5 <small>km</small>
            </b>
          </div>
          <Suspense fallback={<div className="loading-line" />}>
            <MapCanvas
              key={compare}
              compact
              resolution={compare === 'ai' ? 5 : 6}
              syncView={synced ? view : undefined}
              onViewChange={synced ? setView : undefined}
            />
          </Suspense>
          <span className="map-data-tag">
            {compare === 'ai' ? 'ILLUSTRATIVE FINE-SCALE STRUCTURE' : 'ILLUSTRATIVE INTERPOLATION'}
          </span>
        </div>
      </div>
      <div className="lab-bottom">
        <section className="panel comparison-metrics">
          <SectionLabel extra={<DemoTag>ILLUSTRATIVE VALUES</DemoTag>}>
            Validation comparison
          </SectionLabel>
          <p className="muted">
            Synthetic observation reference: <strong>188 mm</strong>. No empirical model skill is
            claimed.
          </p>
          {error ? (
            <p role="alert">{error}</p>
          ) : !data.length ? (
            <div className="loading-line" />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>METRIC</th>
                    {data.map((d) => (
                      <th key={d.id}>
                        {d.resolution} KM {d.id === 'ai' ? 'AI' : d.id.toUpperCase()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      { key: 'peakRainfall', label: 'Peak rainfall', unit: 'mm' },
                      { key: 'wind', label: 'Maximum wind', unit: 'km/h' },
                      { key: 'variance', label: 'Spatial variance', unit: 'mm²' },
                      { key: 'percentile99', label: '99th percentile', unit: 'mm' },
                      { key: 'rmse', label: 'RMSE', unit: 'mm' },
                      { key: 'mae', label: 'MAE', unit: 'mm' },
                      { key: 'extremeError', label: 'Extreme-value error', unit: '%' },
                      { key: 'similarity', label: 'Spatial similarity', unit: '' },
                    ] as const
                  ).map((m) => (
                    <tr key={m.key}>
                      <td>{m.label}</td>
                      {data.map((d) => (
                        <td key={d.id} className={d.id === 'ai' ? 'mint' : ''}>
                          {d[m.key]} <small>{m.unit}</small>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel physics-panel">
          <SectionLabel>Physics consistency</SectionLabel>
          <div className="physics-score">
            94<small>%</small>
            <span>
              <Check size={14} /> Prototype metric
            </span>
          </div>
          <p className="muted">Illustrative checks for physical plausibility.</p>
          {physicsMetrics.map((m) => (
            <div className="contribution" key={m.label}>
              <div>
                <span>{m.label}</span>
                <b>{m.value}%</b>
              </div>
              <div className="contribution-track">
                <i style={{ width: `${m.value}%` }} />
              </div>
            </div>
          ))}
          <p className="fine-print">
            A consistency score is not proof of forecast accuracy. Real validation requires independent
            observations and held-out events.
          </p>
        </section>
      </div>
    </div>
  );
}

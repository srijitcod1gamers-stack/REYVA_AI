import { useState } from 'react';
import { Check, Code2, Copy, Play } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { demoApi } from '../../shared/api';
import { useWeather } from '../providers/WeatherProvider';
import { providerMode } from '../services/weather';
import { DemoTag, PageHeading, SectionLabel } from '../components/ui/Primitives';
import { copy } from '../utils/format';
const endpoints = [
  { id: 'risk', path: '/risk?lat=22.57&lon=88.36', label: 'Location risk' },
  { id: 'events', path: '/events', label: 'Tracked events' },
  { id: 'event', path: '/events/WX-024', label: 'Event intelligence' },
  { id: 'forecast', path: '/forecast?event_id=WX-024&hour=96', label: 'Forecast frame' },
  { id: 'alerts', path: '/alerts', label: 'Alert advisories' },
  { id: 'impact', path: '/impact?event_id=WX-024', label: 'Impact assessment' },
  { id: 'trajectory', path: '/trajectory/WX-024', label: 'Forecast track' },
  { id: 'downscaled', path: '/downscaled/WX-024', label: 'Downscaled fields' },
];
const liveEndpoints = [
  { id: 'live-risk', path: '/live/risk?lat=22.57&lon=88.36&hour=96', label: 'Live coordinate risk' },
  { id: 'events', path: '/events', label: 'Screened events' },
  { id: 'forecast', path: '/forecast?event_id=LIVE-RAIN&hour=96', label: 'Forecast frame' },
  { id: 'alerts', path: '/alerts', label: 'Screening advisories' },
  { id: 'impact', path: '/impact?event_id=LIVE-RAIN&hour=96', label: 'Approximate footprint' },
  { id: 'ml-status', path: '/ml/status', label: 'Model validation status' },
  { id: 'ml-track', path: '/ml/track/LIVE-RAIN?hour=96', label: 'Validated graph track' },
  { id: 'downscaled', path: '/downscaled/LIVE-RAIN?hour=96', label: 'Validated 5 km rainfall' },
];
export default function APIExplorer() {
  const w = useWeather(),
    [params] = useSearchParams(),
    [path, setPath] = useState(
      (providerMode === 'demo' ? endpoints : liveEndpoints).find((e) => e.id === params.get('endpoint'))
        ?.path ?? (providerMode === 'demo' ? endpoints[0] : liveEndpoints[0]).path,
    ),
    [result, setResult] = useState<{ status: number; body: unknown } | null>(null),
    [running, setRunning] = useState(false),
    [duration, setDuration] = useState(0);
  const run = async () => {
    setRunning(true);
    const start = performance.now();
    try {
      if (providerMode === 'demo') setResult(demoApi(new URL(`/api${path}`, location.origin)));
      else {
        const r = await fetch(
          `${import.meta.env.VITE_API_BASE_URL || '/api'}${path}`,
          {
            signal: AbortSignal.timeout(12000),
          },
        );
        setResult({ status: r.status, body: await r.json() });
      }
    } catch (error) {
      setResult({ status: 0, body: { error: String(error) } });
    } finally {
      setDuration(Math.round(performance.now() - start));
      setRunning(false);
    }
  };
  return (
    <div className="page">
      <PageHeading
        eyebrow="BUILT TO CONNECT"
        title="Alert API explorer"
        description={
          providerMode === 'live'
            ? 'Query live forecast screening from the TypeScript Cloudflare Worker.'
            : 'Inspect the TypeScript API contracts used by the command center.'
        }
        actions={
          <DemoTag>
            {providerMode === 'live'
              ? 'LIVE API CONNECTED'
              : providerMode === 'demo'
                ? 'LOCAL DEMO EXECUTION'
                : 'CONNECTED API'}
          </DemoTag>
        }
      />
      <div className="api-layout">
        <aside className="api-endpoints panel">
          <SectionLabel>REST endpoints</SectionLabel>
          {(providerMode === 'demo' ? endpoints : liveEndpoints).map((e) => (
            <button
              key={e.id}
              className={path === e.path ? 'active' : ''}
              onClick={() => {
                setPath(e.path);
                setResult(null);
              }}
            >
              <span>GET</span>
              <div>
                <strong>{e.path.split('?')[0]}</strong>
                <small>{e.label}</small>
              </div>
            </button>
          ))}
          <div className="api-version">
            <Code2 size={17} />
            <span>
              JSON / GeoJSON
              <br />
              <small>Contract v1 · read-only</small>
            </span>
          </div>
        </aside>
        <section className="api-main panel">
          <div className="api-request">
            <span>GET</span>
            <label>
              <span className="sr-only">API request path</span>
              <input value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
            </label>
            <button
              className="primary-button"
              disabled={running || !path.startsWith('/') || path.startsWith('//')}
              onClick={run}
            >
              <Play size={13} />
              {running ? 'Running…' : 'Send request'}
            </button>
          </div>
          <div className="api-code-header">
            <span>RESPONSE</span>
            {result && (
              <span className={result.status === 200 ? 'mint' : 'amber'}>
                {result.status || 'Network error'} {result.status === 200 ? 'OK' : 'Error'}{' '}
                <span className="muted">· {duration} ms</span>
              </span>
            )}
            <button
              className="icon-button"
              aria-label="Copy API response"
              disabled={!result}
              onClick={async () => {
                try {
                  await copy(JSON.stringify(result?.body, null, 2));
                  w.notify('Response copied');
                } catch {
                  w.notify('Clipboard unavailable in this browser');
                }
              }}
            >
              <Copy size={14} />
            </button>
          </div>
          <pre className="api-response">
            {result
              ? JSON.stringify(result.body, null, 2)
              : providerMode === 'live'
                ? '// Choose an endpoint and send a request.\n// Responses come from the live GEFS screening API.\n// Probability and 5 km risk appear only after their models pass validation.'
                : '// Choose an endpoint and send a request.\n// Demo mode executes locally against the shared API contract.\n// All generated data carries explicit simulated provenance.'}
          </pre>
          <SectionLabel>Example request</SectionLabel>
          <pre className="curl-example">
            curl '
            {providerMode === 'demo'
              ? 'http://127.0.0.1:8787/api'
              : import.meta.env.VITE_API_BASE_URL || '/api'}
            {path}'
          </pre>
          <p className="fine-print">
            Live requests use the connected TypeScript API and do not silently fall back to mock data.
          </p>
        </section>
      </div>
    </div>
  );
}

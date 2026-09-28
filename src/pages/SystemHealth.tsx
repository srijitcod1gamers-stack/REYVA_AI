import { useEffect, useState } from 'react';
import { Activity, Check, Cloud, Database, RefreshCw, Server } from 'lucide-react';
import { providerMode } from '../services/weather';
import { DemoTag, PageHeading, SectionLabel } from '../components/ui/Primitives';
import { useWeather } from '../providers/WeatherProvider';
export default function SystemHealth() {
  const w = useWeather(),
    [checking, setChecking] = useState(false),
    [health, setHealth] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState('');
  const refresh = async () => {
    setChecking(true);
    setError('');
    try {
      if (providerMode === 'api') {
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/health`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
        setHealth(await response.json());
      } else {
        setHealth({
          mode: 'demo',
          simulation: 'ready',
          tracked_events: w.events.length,
          live_ingestion: false,
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const systems = [
    {
      name: 'Frontend & WebGL renderer',
      detail: 'React · MapLibre · deck.gl',
      status: 'Ready',
      icon: Activity,
    },
    {
      name: 'Synthetic forecast provider',
      detail: `${w.events.length} events · 29 time steps · deterministic fixtures`,
      status: providerMode === 'demo' ? 'Ready' : 'Disabled',
      icon: Database,
    },
    {
      name: 'Weather data ingestion',
      detail: 'Xarray · Dask · cfgrib',
      status: 'Not connected',
      icon: Database,
    },
    {
      name: 'AI anomaly detector & graph tracker',
      detail: 'PyTorch Geometric · trained weights required',
      status: 'Not connected',
      icon: Server,
    },
    {
      name: 'Diffusion downscaler',
      detail: 'PyTorch · trained weights required',
      status: 'Not connected',
      icon: Server,
    },
    {
      name: 'Impact engine',
      detail: 'GeoPandas · Shapely · authoritative assets required',
      status: 'Demo data',
      icon: Activity,
    },
    {
      name: 'FastAPI inference service',
      detail: 'Python backend · /api/health',
      status: providerMode === 'api' && health && !error ? 'Gateway reachable' : 'Not checked',
      icon: Server,
    },
    {
      name: 'Cloudflare Workers / R2 / D1',
      detail: 'Deployment configuration included',
      status: 'Not checked',
      icon: Cloud,
    },
  ];
  return (
    <div className="page">
      <PageHeading
        eyebrow="OBSERVABILITY & DATA FRESHNESS"
        title="System health"
        description="An honest view of connected services and the boundaries of the prototype."
        actions={
          <button className="secondary-button" onClick={refresh} disabled={checking}>
            <RefreshCw size={14} className={checking ? 'spin' : ''} />
            {checking ? 'Checking…' : 'Refresh status'}
          </button>
        }
      />
      <div className="health-summary panel">
        <span className="status-dot" />
        <div>
          <h2>Demo workspace operational</h2>
          <p>
            Local visualization and simulation are available. Production services require configuration.
          </p>
        </div>
        <DemoTag>{providerMode.toUpperCase()} PROVIDER</DemoTag>
      </div>
      <div className="system-list panel">
        {systems.map((s) => (
          <div className="system-row" key={s.name}>
            <s.icon size={20} />
            <div>
              <strong>{s.name}</strong>
              <small>{s.detail}</small>
            </div>
            <span className={`system-status ${s.status === 'Ready' ? 'ready' : ''}`}>
              <i />
              {s.status}
            </span>
          </div>
        ))}
      </div>
      <div className="panel health-response">
        <SectionLabel>Last health response</SectionLabel>
        {error ? (
          <p role="alert" className="amber">
            {error}
          </p>
        ) : (
          <pre>{JSON.stringify(health, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

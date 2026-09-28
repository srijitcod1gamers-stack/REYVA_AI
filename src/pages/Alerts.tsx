import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Code2, Copy, Download, MapPin, Share2, Siren } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { provider } from '../services/weather';
import { useWeather } from '../providers/WeatherProvider';
import type { Alert } from '../../shared/types';
import { Badge, DemoTag, Metric, PageHeading, SectionLabel } from '../components/ui/Primitives';
import { copy, download, number, utc } from '../utils/format';
export default function Alerts() {
  const w = useWeather(),
    navigate = useNavigate(),
    [params, setParams] = useSearchParams(),
    [alerts, setAlerts] = useState<Alert[]>([]),
    [error, setError] = useState(''),
    [filter, setFilter] = useState('ALL');
  useEffect(() => {
    const c = new AbortController();
    provider
      .getAlerts(c.signal)
      .then(setAlerts)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  const selected = alerts.find((a) => a.id === params.get('id')) ?? alerts[0];
  const filtered = alerts.filter((a) => filter === 'ALL' || a.severity === filter);
  const copyAlert = async () => {
    try {
      await copy(JSON.stringify(selected, null, 2));
      w.notify('Alert copied as JSON');
    } catch {
      w.notify('Clipboard is unavailable. Use Export JSON instead.');
    }
  };
  const share = async () => {
    const url = `${location.origin}/alerts?id=${selected.id}`;
    try {
      if (navigator.share)
        await navigator.share({ title: `${selected.id} · Simulated weather alert`, url });
      else {
        await copy(url);
        w.notify('Alert link copied');
      }
    } catch {
      w.notify('Sharing was cancelled or is unavailable.');
    }
  };
  return (
    <div className="page">
      <PageHeading
        eyebrow="ACTIONABLE, TRACEABLE, EXPORTABLE"
        title="Alert center"
        description="Location-aware advisories with uncertainty and exposure context."
        actions={<DemoTag>DEMONSTRATION ADVISORIES</DemoTag>}
      />
      <div className="alert-toolbar">
        <div className="segment-control">
          {['ALL', 'SEVERE', 'HIGH', 'MODERATE', 'LOW'].map((s) => (
            <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>
              {s === 'ALL' ? 'All alerts' : s.toLowerCase()}
            </button>
          ))}
        </div>
        <span className="muted">{filtered.length} advisories · No messages sent</span>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="alert-layout">
        <div className="alert-list">
          {filtered.map((a) => (
            <button
              key={a.id}
              className={`panel alert-card ${selected?.id === a.id ? 'selected' : ''}`}
              onClick={() => setParams({ id: a.id })}
            >
              <div>
                <Badge severity={a.severity} />
                <span className="mono muted">{a.id}</span>
              </div>
              <h3>{a.title}</h3>
              <p>
                <MapPin size={13} />
                {a.region}
              </p>
              <div className="alert-card-footer">
                <span>{a.confidence}% confidence</span>
                <span>{a.acknowledged ? 'Reviewed' : `Lead ${a.leadHours}h`}</span>
              </div>
            </button>
          ))}
          {!filtered.length && <div className="panel empty-state">No alerts at this severity.</div>}
        </div>
        {selected && (
          <section className="panel alert-detail">
            <SectionLabel extra={<span className="mono">{selected.id}</span>}>
              Advisory intelligence
            </SectionLabel>
            <h2>{selected.title}</h2>
            <div className="event-status-row">
              <Badge severity={selected.severity} />
              <span className="muted">{selected.region}</span>
            </div>
            <div className="alert-detail-metrics">
              <Metric label="Confidence" value={selected.confidence} unit="%" />
              <Metric label="Lead time" value={selected.leadHours} unit="h" />
              <Metric label="Expected rainfall" value={selected.rainfall} unit="mm" />
              <Metric label="Expected wind" value={selected.wind} unit="km/h" />
            </div>
            <div className="impact-list">
              <div>
                <span>Event reference</span>
                <b>{selected.eventId}</b>
              </div>
              <div>
                <span>Forecast window</span>
                <b>{utc(selected.forecastWindow)} UTC</b>
              </div>
              <div>
                <span>Potential population exposure</span>
                <b>{number(selected.population)}</b>
              </div>
              <div>
                <span>Issued</span>
                <b>{utc(selected.timestamp)} UTC</b>
              </div>
              <div>
                <span>Source</span>
                <b>Synthetic global ensemble</b>
              </div>
            </div>
            <div className="info-note">
              <Siren size={18} />
              <span>
                This is a simulated advisory for demonstration. Follow official agency guidance for real
                emergencies.
              </span>
            </div>
            <div className="alert-actions">
              <button
                className="primary-button"
                onClick={() => {
                  w.selectEvent(selected.eventId);
                  navigate('/');
                }}
              >
                <MapPin size={14} /> View on map
              </button>
              <button className="secondary-button" onClick={copyAlert}>
                <Copy size={14} /> Copy alert
              </button>
              <button
                className="secondary-button"
                onClick={() => download(`${selected.id}.json`, selected)}
              >
                <Download size={14} /> JSON
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  download(`${selected.id}.geojson`, {
                    type: 'FeatureCollection',
                    features: [
                      {
                        ...selected.polygon,
                        properties: { ...selected.polygon.properties, provenance: selected.provenance },
                      },
                    ],
                  })
                }
              >
                <Download size={14} /> GeoJSON
              </button>
              <button className="secondary-button" onClick={share}>
                <Share2 size={14} /> Share
              </button>
              <button className="secondary-button" onClick={() => navigate('/api?endpoint=alerts')}>
                <Code2 size={14} /> API preview
              </button>
            </div>
            <button
              className="text-button"
              onClick={() => {
                setAlerts((a) =>
                  a.map((row) =>
                    row.id === selected.id ? { ...row, acknowledged: !row.acknowledged } : row,
                  ),
                );
                w.notify(
                  selected.acknowledged
                    ? 'Review status cleared for this session'
                    : 'Marked reviewed in this session',
                );
              }}
            >
              <Check size={14} />
              {selected.acknowledged ? 'Clear reviewed status' : 'Mark reviewed in this session'}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

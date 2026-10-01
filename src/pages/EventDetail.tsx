import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Download, ExternalLink } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWeather } from '../providers/WeatherProvider';
import { Badge, DemoTag, Metric, PageHeading, SectionLabel } from '../components/ui/Primitives';
import { EnsembleDetail, ExplainableAI, ImpactDetail } from '../components/events/EventIntelligence';
import { TimelineController } from '../components/timeline/TimelineController';
import { download, utc } from '../utils/format';
import { deltaFor } from '../../shared/simulation';
const MapCanvas = lazy(() => import('../components/map/MapCanvas'));
export default function EventDetail() {
  const w = useWeather(),
    { id } = useParams(),
    navigate = useNavigate(),
    [tab, setTab] = useState('Overview');
  useEffect(() => {
    if (id) w.selectEvent(id);
  }, [id]);
  const event = w.events.find((e) => e.id === id);
  if (!event)
    return (
      <div className="page">
        <h1>Event not found</h1>
        <button onClick={() => navigate('/events')}>Back to events</button>
      </div>
    );
  if (event.provenance.kind === 'forecast') return <LiveEventDetail />;
  return (
    <div className="page event-detail-page">
      <button className="text-button" onClick={() => navigate('/events')}>
        <ArrowLeft size={14} /> All extreme events
      </button>
      <PageHeading
        eyebrow={`EVENT INTELLIGENCE / ${event.id}`}
        title={event.name}
        description={`${event.region} · Global ensemble · Synthetic run ${utc(event.provenance.run)} UTC`}
        actions={
          <>
            <Badge severity={w.frame.severity} />
            <button
              className="secondary-button"
              onClick={() =>
                download(`${event.id}-intelligence.json`, {
                  event,
                  frame: w.frame,
                  delta: deltaFor(w.frame),
                })
              }
            >
              <Download size={14} /> Export intelligence
            </button>
          </>
        }
      />
      <div className="detail-page-tabs">
        {[
          'Overview',
          'Timeline',
          'Trajectory',
          'Forecast variables',
          'Ensemble',
          'Downscaling',
          'Impact',
          'AI explanation',
          'Forecast changes',
          'Alerts',
        ].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="detail-page-grid">
        <div className="detail-main">
          <div className="detail-map panel">
            <Suspense fallback={<div className="loading-line" />}>
              <MapCanvas compact />
            </Suspense>
            <button className="map-pill" onClick={() => navigate('/')}>
              <ExternalLink size={13} /> Open 4D command map
            </button>
          </div>
          <TimelineController />
          {tab === 'Timeline' || tab === 'Trajectory' ? (
            <div className="panel trajectory-table">
              <SectionLabel>Forecast trajectory · synthetic</SectionLabel>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Time UTC</th>
                      <th>Lat / Lon</th>
                      <th>Rainfall</th>
                      <th>Wind</th>
                      <th>Pressure</th>
                      <th>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.trajectory
                      .filter((p) => p.hour % 24 === 0)
                      .map((p) => (
                        <tr key={p.hour} onClick={() => w.setHour(p.hour)}>
                          <td>{utc(p.timestamp)}</td>
                          <td>
                            {p.coordinates[1].toFixed(2)} / {p.coordinates[0].toFixed(2)}
                          </td>
                          <td>{p.metrics.rainfall} mm</td>
                          <td>{p.metrics.wind} km/h</td>
                          <td>{p.metrics.pressure} hPa</td>
                          <td>{p.confidence}%</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="detail-metric-grid panel">
              <Metric label="Rainfall / 24h" value={w.frame.metrics.rainfall} unit="mm" />
              <Metric label="10m wind" value={w.frame.metrics.wind} unit="km/h" />
              <Metric label="Sea-level pressure" value={w.frame.metrics.pressure} unit="hPa" />
              <Metric label="Relative humidity" value={w.frame.metrics.humidity} unit="%" />
              {!w.frame.grid && (
                <Metric label="Temperature" value={w.frame.metrics.temperature} unit="°C" />
              )}
              <Metric label="Anomaly score" value={w.frame.metrics.anomaly} unit="%" />
            </div>
          )}
        </div>
        <aside className="detail-side panel">
          <SectionLabel>{tab}</SectionLabel>
          {tab === 'AI explanation' ? (
            <ExplainableAI />
          ) : tab === 'Impact' ? (
            <ImpactDetail />
          ) : tab === 'Forecast changes' ? (
            <>
              <div className="big-number amber">
                +21<small> pp</small>
              </div>
              <p>
                Rainfall probability increased from {deltaFor(w.frame).previous}% to{' '}
                {deltaFor(w.frame).current}% in this illustrative run comparison.
              </p>
              <div className="impact-list">
                <div>
                  <span>Threat-center shift</span>
                  <b>31 km NW</b>
                </div>
                <div>
                  <span>Arrival</span>
                  <b>6h earlier</b>
                </div>
                <div>
                  <span>Additional exposure</span>
                  <b>28,400</b>
                </div>
              </div>
              <button
                className="secondary-button full"
                onClick={() => {
                  w.setCompare(true);
                  navigate('/');
                }}
              >
                Compare on map <ArrowUpRight size={14} />
              </button>
            </>
          ) : ['Downscaling', 'Alerts'].includes(tab) ? (
            <>
              <p className="muted">
                Explore {tab.toLowerCase()} for {event.id} in the dedicated workspace.
              </p>
              <button
                className="primary-button"
                onClick={() => navigate(tab === 'Downscaling' ? '/downscaling' : '/alerts')}
              >
                Open {tab.toLowerCase()} <ArrowUpRight size={14} />
              </button>
            </>
          ) : (
            <EnsembleDetail />
          )}
          <div className="fine-print">{event.provenance.disclaimer}</div>
        </aside>
      </div>
    </div>
  );
}
function LiveEventDetail() {
  const w = useWeather();
  const navigate = useNavigate();
  const event = w.selected;
  return (
    <div className="page event-detail-page">
      <button className="text-button" onClick={() => navigate('/events')}>
        <ArrowLeft size={14} /> All signals
      </button>
      <PageHeading
        eyebrow={`FORECAST SCREENING / ${event.id}`}
        title={event.name}
        description={`${event.region} · NOAA GEFS 0.25° ensemble mean · forecast run ${utc(event.provenance.run)} UTC`}
        actions={<Badge severity={w.frame.severity} />}
      />
      <div className="detail-page-grid">
        <div className="detail-main">
          <div className="detail-map panel">
            <Suspense fallback={<div className="loading-line" />}>
              <MapCanvas compact />
            </Suspense>
            <button className="map-pill" onClick={() => navigate('/')}>
              <ExternalLink size={13} /> Open command map
            </button>
          </div>
          <TimelineController />
          <div className="panel trajectory-table">
            <SectionLabel>Forecast object positions</SectionLabel>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Time UTC</th>
                    <th>Lat / Lon</th>
                    <th>Rain / 24h</th>
                    <th>Wind gust</th>
                    <th>Pressure</th>
                  </tr>
                </thead>
                <tbody>
                  {event.trajectory
                    .filter((p) => p.hour % 24 === 0)
                    .map((p) => (
                      <tr key={p.hour} onClick={() => w.setHour(p.hour)}>
                        <td>{utc(p.timestamp)}</td>
                        <td>
                          {p.coordinates[1].toFixed(2)} / {p.coordinates[0].toFixed(2)}
                        </td>
                        <td>{p.metrics.rainfall} mm</td>
                        <td>{p.metrics.wind} km/h</td>
                        <td>{p.metrics.pressure} hPa</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <aside className="detail-side panel">
          <SectionLabel>Current forecast step</SectionLabel>
          <div className="location-metrics">
            <Metric label="Rainfall / 24h" value={w.frame.metrics.rainfall} unit="mm" />
            <Metric label="Wind gust" value={w.frame.metrics.wind} unit="km/h" />
            <Metric label="Pressure" value={w.frame.metrics.pressure} unit="hPa" />
            {!w.frame.grid && (
              <Metric label="Temperature" value={w.frame.metrics.temperature} unit="°C" />
            )}
          </div>
          <div className="info-note">{event.provenance.disclaimer}</div>
          <button
            className="secondary-button full"
            onClick={() => download(`${event.id}-forecast.json`, { event, frame: w.frame })}
          >
            <Download size={14} /> Export forecast JSON
          </button>
          <button className="primary-button full" onClick={() => navigate('/alerts')}>
            Open screening advisories <ArrowUpRight size={14} />
          </button>
        </aside>
      </div>
    </div>
  );
}

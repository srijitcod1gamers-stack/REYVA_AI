import { useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpRight, Radar, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWeather } from '../providers/WeatherProvider';
import { Badge, DemoTag, PageHeading, Sparkline } from '../components/ui/Primitives';
import { eventIcons } from '../components/events/EventFeed';

export default function Events() {
  const w = useWeather(),
    navigate = useNavigate(),
    [query, setQuery] = useState(''),
    [severity, setSeverity] = useState('ALL');
  const events = w.events.filter(
    (e) =>
      `${e.name} ${e.region} ${e.id}`.toLowerCase().includes(query.toLowerCase()) &&
      (severity === 'ALL' || e.severity === severity),
  );
  return (
    <div className="page">
      <PageHeading
        eyebrow="CONTINUOUS DISCOVERY"
        title="Extreme event intelligence"
        description="From forecast anomalies to tracked, explainable weather systems."
        actions={<DemoTag />}
      />
      <div className="discovery-strip panel">
        <div className="scanner-icon">
          <Radar size={25} />
        </div>
        <div>
          <strong>Domain scan complete</strong>
          <p>1,248,320 grid cells · 6 atmospheric variables · 23 synthetic ensemble members</p>
        </div>
        <div>
          <b>14</b>
          <small>Candidate anomalies</small>
        </div>
        <div>
          <b>04</b>
          <small>Tracked events</small>
        </div>
      </div>
      <div className="table-toolbar">
        <div className="input-with-icon">
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events or regions"
            aria-label="Search events"
          />
        </div>
        <select
          aria-label="Filter event severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          <option value="ALL">All severities</option>
          <option>SEVERE</option>
          <option>HIGH</option>
          <option>MODERATE</option>
        </select>
        <span>{events.length} events</span>
      </div>
      <div className="event-table panel">
        <div className="event-table-head">
          <span>EVENT / REGION</span>
          <span>SEVERITY</span>
          <span>CONFIDENCE</span>
          <span>TREND</span>
          <span>LEAD TIME</span>
          <span />
        </div>
        {events.map((e) => {
          const Icon = eventIcons[e.type];
          return (
            <button
              className="event-table-row"
              key={e.id}
              onClick={() => {
                w.selectEvent(e.id);
                navigate(`/events/${e.id}`);
              }}
            >
              <div className="table-event">
                <span className={`event-icon icon-${e.type}`}>
                  <Icon size={21} />
                </span>
                <span>
                  <strong>{e.name}</strong>
                  <small>
                    {e.id} · {e.region}
                  </small>
                </span>
              </div>
              <Badge severity={e.severity} />
              <span className="table-confidence">
                {e.confidence}
                <small>%</small>
                <i style={{ width: `${e.confidence}%` }} />
              </span>
              <span className="table-trend">
                <Sparkline variant={w.events.indexOf(e)} />
                {e.status}
              </span>
              <b className="mono">{e.leadTime}h</b>
              <ArrowUpRight size={17} />
            </button>
          );
        })}
        {!events.length && (
          <p className="empty-state">No events match your filters. Try another region or severity.</p>
        )}
      </div>
      <div className="info-note">
        <Radar size={18} />
        <span>
          Discovery and classifications are simulated. A real anomaly detector can replace this data
          provider without changing the interface.
        </span>
      </div>
    </div>
  );
}

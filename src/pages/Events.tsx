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
        description="Screened rainfall, wind and heat signals across the medium-range forecast."
        actions={
          <DemoTag>
            {w.selected.provenance.kind === 'forecast'
              ? 'LIVE GEFS INPUT · SCREENING'
              : 'SIMULATED DATA'}
          </DemoTag>
        }
      />
      <div className="discovery-strip panel">
        <div className="scanner-icon">
          <Radar size={25} />
        </div>
        <div>
          <strong>Domain scan complete</strong>
          <p>
            {w.selected.provenance.kind === 'forecast'
              ? w.frame.grid
                ? 'Contiguous native-grid rainfall / wind objects / day 3–10 / 24-hour steps'
                : '16 regional sample sites · day 3–10'
              : 'Synthetic regional demonstration'}
          </p>
        </div>
        <div>
          <b>
            {w.frame.grid
              ? w.frame.grid.fields.rainfall!.latitudes.length *
                w.frame.grid.fields.rainfall!.longitudes.length
              : w.selected.provenance.kind === 'forecast'
                ? '16'
                : '04'}
          </b>
          <small>
            {w.frame.grid
              ? 'Native grid cells'
              : w.selected.provenance.kind === 'forecast'
                ? 'Sample sites'
                : 'Candidate anomalies'}
          </small>
        </div>
        <div>
          <b>{String(w.events.length).padStart(2, '0')}</b>
          <small>Screened signals</small>
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
          <span>
            {w.frame.grid
              ? 'TRACK STEPS'
              : w.selected.provenance.kind === 'forecast'
                ? 'SCREENING INDEX'
                : 'CONFIDENCE'}
          </span>
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
                {w.frame.grid ? (
                  e.trajectory.length
                ) : (
                  <>
                    {e.confidence}
                    <small>%</small>
                    <i style={{ width: `${e.confidence}%` }} />
                  </>
                )}
              </span>
              <span className="table-trend">
                {e.provenance.kind !== 'forecast' && <Sparkline variant={w.events.indexOf(e)} />}
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
        <span>{w.selected.provenance.disclaimer}</span>
      </div>
    </div>
  );
}

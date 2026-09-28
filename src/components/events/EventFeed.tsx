import { useEffect, useState } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CloudRain,
  Filter,
  Radar,
  Snowflake,
  ThermometerSun,
  Wind,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWeather } from '../../providers/WeatherProvider';
import { Badge, SectionLabel, Sparkline } from '../ui/Primitives';
import type { WeatherEvent } from '../../../shared/types';

export const eventIcons = { cyclone: Wind, rainfall: CloudRain, heat: ThermometerSun, cold: Snowflake };
export function EventFeed() {
  const w = useWeather(),
    navigate = useNavigate(),
    [highOnly, setHighOnly] = useState(false),
    [scan, setScan] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setScan((v) => (v + 1) % 6), 2400);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (scan === 5 && !sessionStorage.getItem('weather-demo-discovery')) {
      sessionStorage.setItem('weather-demo-discovery', '1');
      w.notify('New synthetic extreme event detected · WX-024 · Bay of Bengal');
    }
  }, [scan, w.notify]);
  const shown = highOnly
    ? w.events.filter((e) => e.severity === 'SEVERE' || e.severity === 'HIGH')
    : w.events;
  return (
    <aside className="event-feed panel" aria-label="Active weather threats">
      <div className="feed-heading">
        <div>
          <span className="eyebrow">AI EVENT DISCOVERY</span>
          <h2>
            Active threats <span>{String(shown.length).padStart(2, '0')}</span>
          </h2>
        </div>
        <button
          className={`icon-button ${highOnly ? 'selected' : ''}`}
          title={highOnly ? 'Show all threats' : 'Show high and severe threats'}
          aria-label="Filter high severity events"
          aria-pressed={highOnly}
          onClick={() => setHighOnly(!highOnly)}
        >
          <Filter size={15} />
        </button>
      </div>
      <div className="scanner-status">
        <div className="scanner-icon">
          <Radar size={19} />
        </div>
        <div>
          <strong>{scan === 5 ? 'New extreme detected' : 'Scanning forecast domain'}</strong>
          <span>
            {
              [
                'Pressure & circulation',
                'Wind vectors',
                'Rainfall extremes',
                'Temperature anomalies',
                'Humidity & moisture',
                'WX-024 · synthetic discovery',
              ][scan]
            }
          </span>
        </div>
        <span className="status-dot" />
      </div>
      <div className="event-list">
        {shown.map((event, index) => (
          <EventCard
            key={event.id}
            event={event}
            selected={event.id === w.selected.id}
            index={index}
            onSelect={() => w.selectEvent(event.id)}
          />
        ))}
      </div>
      <div className="feed-bottom">
        <span>
          <i className="status-dot" />
          1.24M grid cells analyzed
        </span>
        <button onClick={() => navigate('/events')}>
          View all events <ArrowRight size={13} />
        </button>
      </div>
    </aside>
  );
}
export function EventCard({
  event,
  selected,
  index = 0,
  onSelect,
}: {
  event: WeatherEvent;
  selected: boolean;
  index?: number;
  onSelect: () => void;
}) {
  const Icon = eventIcons[event.type];
  return (
    <button
      className={`event-card ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="event-card-top">
        <span className={`event-icon icon-${event.type}`}>
          <Icon size={18} />
        </span>
        <span className="event-id">{event.id}</span>
        <Badge severity={event.severity} />
      </div>
      <strong>{event.name}</strong>
      <span className="event-region">{event.region}</span>
      <div className="event-confidence">
        <span>
          <b>
            {event.confidence}
            <small>%</small>
          </b>
          <small>Confidence</small>
        </span>
        <Sparkline
          color={event.type === 'cyclone' ? '#e59e81' : event.type === 'cold' ? '#8cafcf' : '#c7b277'}
          variant={index}
        />
      </div>
      <div className="event-card-bottom">
        <span>
          {event.trend === 'intensifying' ? (
            <ArrowUpRight size={12} />
          ) : event.trend === 'weakening' ? (
            <ArrowDownRight size={12} />
          ) : (
            <ArrowRight size={12} />
          )}{' '}
          {event.status}
        </span>
        <span>T−{event.leadTime}h</span>
      </div>
    </button>
  );
}

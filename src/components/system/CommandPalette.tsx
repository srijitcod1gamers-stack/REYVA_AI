import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Clock3,
  CloudRain,
  Command,
  FlaskConical,
  GitCompareArrows,
  Layers,
  MapPin,
  Search,
  ShieldCheck,
  Wind,
} from 'lucide-react';
import { places } from '../../../shared/fixtures';
import { useWeather } from '../../providers/WeatherProvider';
import { Modal } from '../ui/Primitives';

export function CommandPalette() {
  const w = useWeather(),
    navigate = useNavigate(),
    [query, setQuery] = useState('');
  const close = useCallback(() => w.setCommandOpen(false), [w.setCommandOpen]);
  const run = (action: () => void) => {
    action();
    close();
  };
  const commands = [
    {
      label: 'Toggle rainfall',
      icon: CloudRain,
      action: () => w.setVariable(w.variable === 'rainfall' ? 'anomaly' : 'rainfall'),
    },
    { label: 'Toggle wind particles', icon: Wind, action: () => w.toggleLayer('wind') },
    { label: 'Toggle ensemble members', icon: Layers, action: () => w.toggleLayer('ensemble') },
    {
      label: 'Switch disaster response mode',
      icon: ShieldCheck,
      action: () => {
        w.setMode(w.mode === 'response' ? 'meteorology' : 'response');
        navigate('/');
      },
    },
    {
      label: 'Open historical replay',
      icon: Clock3,
      action: () => {
        w.setReplay(true);
        navigate('/replay');
      },
    },
    {
      label: 'Compare forecast runs',
      icon: GitCompareArrows,
      action: () => {
        w.setCompare(!w.compare);
        navigate('/');
      },
    },
    { label: 'Open downscaling lab', icon: FlaskConical, action: () => navigate('/downscaling') },
    { label: 'Jump to current forecast time', icon: Clock3, action: () => w.setHour(96) },
  ];
  const q = query.toLowerCase();
  const coords = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  const validCoords = coords && Math.abs(Number(coords[1])) <= 90 && Math.abs(Number(coords[2])) <= 180;
  const filteredPlaces = places.filter((p) => `${p.name} ${p.region}`.toLowerCase().includes(q));
  const filteredCommands = commands.filter((c) => c.label.toLowerCase().includes(q));
  const filteredEvents = w.events.filter((e) =>
    `${e.id} ${e.name} ${e.region}`.toLowerCase().includes(q),
  );
  return (
    <Modal title="Command palette" close={close} className="command-modal">
      <div className="palette-search">
        <Search size={20} />
        <input
          autoFocus
          placeholder="Search a place, event, or command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search commands or locations"
        />
        <kbd>ESC</kbd>
      </div>
      <div className="palette-results">
        {validCoords && (
          <button
            onClick={() =>
              run(() => {
                w.inspectLocation([Number(coords[2]), Number(coords[1])]);
                navigate('/');
              })
            }
          >
            <MapPin size={17} />
            <span>
              Inspect {coords[1]}° latitude, {coords[2]}° longitude
            </span>
            <ArrowUpRight size={15} />
          </button>
        )}
        {filteredPlaces.length > 0 && (
          <>
            <div className="eyebrow">LOCATIONS</div>
            {filteredPlaces.slice(0, query ? 8 : 3).map((p) => (
              <button
                key={p.name}
                onClick={() =>
                  run(() => {
                    w.inspectLocation(p.coordinates, p.name);
                    navigate('/');
                  })
                }
              >
                <MapPin size={17} />
                <span>
                  {p.name}
                  <small>{p.region}</small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </>
        )}
        {filteredEvents.length > 0 && (
          <>
            <div className="eyebrow">TRACKED EVENTS</div>
            {filteredEvents.slice(0, query ? 4 : 1).map((e) => (
              <button
                key={e.id}
                onClick={() =>
                  run(() => {
                    w.selectEvent(e.id);
                    navigate('/');
                  })
                }
              >
                <Wind size={17} />
                <span>
                  {e.name}
                  <small>
                    {e.id} · {e.region}
                  </small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </>
        )}
        {filteredCommands.length > 0 && (
          <>
            <div className="eyebrow">QUICK ACTIONS</div>
            {filteredCommands.map(({ label, icon: Icon, action }) => (
              <button key={label} onClick={() => run(action)}>
                <Icon size={17} />
                <span>{label}</span>
                <Command size={13} />
              </button>
            ))}
          </>
        )}
        {!validCoords &&
          filteredPlaces.length + filteredEvents.length + filteredCommands.length === 0 && (
            <p className="empty-state">
              No matches. Try Kolkata, WX-024, or coordinates such as 22.57, 88.36.
            </p>
          )}
      </div>
      <div className="palette-footer">
        Search the demo locality catalog or enter latitude, longitude.
      </div>
    </Modal>
  );
}

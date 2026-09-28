import { useCallback, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Activity,
  Bell,
  Blocks,
  ChevronDown,
  CircleHelp,
  Clock3,
  Code2,
  Command,
  Database,
  FlaskConical,
  Globe2,
  Map,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Siren,
  X,
} from 'lucide-react';
import { useWeather } from '../../providers/WeatherProvider';
import { Modal } from '../ui/Primitives';
import { CommandPalette } from './CommandPalette';
import { providerMode } from '../../services/weather';

const links = [
  { to: '/', label: 'Command center', icon: Map },
  { to: '/events', label: 'Extreme events', icon: Activity },
  { to: '/downscaling', label: 'Downscaling lab', icon: FlaskConical },
  { to: '/impact', label: 'Impact intelligence', icon: ShieldCheck },
  { to: '/replay', label: 'Historical replay', icon: Clock3 },
  { to: '/models', label: 'AI pipeline', icon: Blocks },
];
export function AppShell({ children }: { children: ReactNode }) {
  const w = useWeather(),
    navigate = useNavigate();
  const [settings, setSettings] = useState(false),
    [profile, setProfile] = useState(false);
  const closeSettings = useCallback(() => setSettings(false), []);
  return (
    <div className="app-shell">
      <header className="command-header">
        <NavLink to="/" className="brand" aria-label="Weather Intelligence AI home">
          <img src="/favicon.svg" alt="" />
          <span>
            <strong>
              WEATHER INTELLIGENCE<span className="brand-ai">AI</span>
            </strong>
            <small>SEE THE SIGNAL. ANTICIPATE THE IMPACT.</small>
          </span>
        </NavLink>
        <div className="header-context">
          <button
            className={`live-switch ${w.replay ? 'replaying' : ''}`}
            onClick={() => {
              w.setReplay(!w.replay);
              navigate(w.replay ? '/' : '/replay');
            }}
          >
            <span className="status-dot" />
            {w.replay ? 'REPLAY' : 'LIVE VIEW'}
            <ChevronDown size={12} />
          </button>
          <span className="header-divider" />
          <div className="model-context">
            <strong>
              Global ensemble <span>23 members</span>
            </strong>
            <small>
              {w.replay ? '14 MAY 2020' : '27 SEP 2026'} <b>00Z</b> <span>·</span> T+72–240h
            </small>
          </div>
        </div>
        <div className="header-tools">
          <button
            className="search-trigger"
            onClick={() => w.setCommandOpen(true)}
            aria-label="Search locations and commands"
          >
            <Search size={15} />
            <span>Search anything</span>
            <kbd>⌘ K</kbd>
          </button>
          <button
            className="icon-button notification-button"
            aria-label="Open alert center"
            onClick={() => navigate('/alerts')}
          >
            <Bell size={18} />
            <i />
          </button>
          <button className="icon-button" aria-label="Settings" onClick={() => setSettings(true)}>
            <Settings2 size={18} />
          </button>
          <button
            className="avatar"
            aria-label="Workspace profile"
            onClick={() => setProfile((v) => !v)}
          >
            OP
          </button>
        </div>
        {profile && (
          <div className="profile-menu panel">
            <strong>Operations workspace</strong>
            <span>SIH 2026 · Prototype session</span>
            <button
              onClick={() => {
                navigate('/system');
                setProfile(false);
              }}
            >
              <Activity size={15} /> System health
            </button>
            <button
              onClick={() => {
                navigate('/data');
                setProfile(false);
              }}
            >
              <Database size={15} /> Data provenance
            </button>
          </div>
        )}
      </header>
      <nav className="main-nav" aria-label="Main navigation">
        <div className="nav-links">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <Icon size={15} />
              <span>{label}</span>
              {to === '/events' && <b>04</b>}
            </NavLink>
          ))}
        </div>
        <div className="nav-right">
          <NavLink to="/api" title="API Explorer">
            <Code2 size={16} />
            <span>API</span>
          </NavLink>
          <NavLink to="/system" className="system-link">
            <span className="status-dot" />
            {providerMode === 'demo' ? 'Demo systems ready' : 'API connected'}
          </NavLink>
        </div>
      </nav>
      {w.error && (
        <div className="error-banner" role="alert">
          {w.error}
          <button onClick={w.retry}>Retry</button>
        </div>
      )}
      <main className="app-content">{children}</main>
      <footer className="status-footer">
        <div>
          <span className="status-dot" />
          <span>{providerMode === 'demo' ? 'DEMO ENVIRONMENT' : 'API ENVIRONMENT'}</span>
          <i />
          <span>Simulated data · Not an official forecast</span>
        </div>
        <div>
          <Globe2 size={11} />
          <span>INDIAN OCEAN DOMAIN</span>
          <i />
          <button onClick={() => navigate('/data')}>Data & attribution</button>
          <span className="footer-version">v1.0 / SIH 2026</span>
        </div>
      </footer>
      {w.toast && (
        <div className="toast" role="status">
          <ShieldCheck size={17} />
          {w.toast}
          <button aria-label="Dismiss notification" onClick={() => w.notify('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {w.commandOpen && <CommandPalette />}
      {settings && (
        <Modal title="Workspace settings" close={closeSettings}>
          <div className="settings-content">
            <p className="muted">Configure this operations session.</p>
            <label className="form-label">
              Measurement units
              <select
                value={w.units}
                onChange={(e) => w.setUnits(e.target.value as 'metric' | 'imperial')}
              >
                <option value="metric">Metric · mm, km/h</option>
                <option value="imperial">Imperial · in, mph</option>
              </select>
            </label>
            <label className="form-label">
              Playback speed
              <select value={w.speed} onChange={(e) => w.setSpeed(Number(e.target.value))}>
                {[0.5, 1, 2, 4].map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
            <div className="info-note">
              <CircleHelp size={17} />
              <span>
                Weather fields are synthetic. The displayed forecast run is fixed for reproducible
                demonstrations.
              </span>
            </div>
            <button
              className="secondary-button"
              onClick={() => {
                w.setHour(96);
                w.setPlaying(false);
                w.setView('2d');
                w.setCompare(false);
                w.notify('Workspace view reset');
                closeSettings();
              }}
            >
              Reset workspace view
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

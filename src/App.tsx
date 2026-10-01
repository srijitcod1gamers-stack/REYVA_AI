import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/system/AppShell';
import { WeatherProvider } from './providers/WeatherProvider';
const Historical = lazy(() => import('./pages/Historical'));
const CommandCenter = lazy(() => import('./pages/CommandCenter'));
const Events = lazy(() => import('./pages/Events'));
const EventDetail = lazy(() => import('./pages/EventDetail'));
const Downscaling = lazy(() => import('./pages/Downscaling'));
const Impact = lazy(() => import('./pages/Impact'));
const Alerts = lazy(() => import('./pages/Alerts'));
const APIExplorer = lazy(() => import('./pages/APIExplorer'));

export default function App() {
  const path = useLocation().pathname;
  if (path === '/replay' || path === '/downscaling')
    return (
      <div className="app-shell">
        <header className="command-header">
          <NavLink to="/" className="brand">
            <img src="/favicon.svg" alt="" />
            <span>
              <strong>WEATHER INTELLIGENCE AI</strong>
              <small>REAL FORECASTS. MEASURED VALIDATION.</small>
            </span>
          </NavLink>
          <span className="header-context">
            {path === '/replay'
              ? 'NOAA / CHIRPS historical archive'
              : 'Forecast verification and model release'}
          </span>
        </header>
        <nav className="main-nav">
          <div className="nav-links">
            {[
              ['/', 'Command center'],
              ['/events', 'Extreme events'],
              ['/downscaling', 'Downscaling lab'],
              ['/impact', 'Impact intelligence'],
              ['/replay', 'Historical replay'],
            ].map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                {label}
              </NavLink>
            ))}
          </div>
        </nav>
        <main className="app-content">
          <Suspense fallback={<div className="page-loading">Loading dataset workspace…</div>}>
            {path === '/replay' ? <Historical /> : <Downscaling />}
          </Suspense>
        </main>
      </div>
    );
  return (
    <WeatherProvider>
      <LiveApp />
    </WeatherProvider>
  );
}
function LiveApp() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="page-loading">
            <div className="loading-line" />
            Loading workspace…
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<CommandCenter />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/downscaling" element={<Downscaling />} />
          <Route path="/impact" element={<Impact />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/api" element={<APIExplorer />} />
          <Route
            path="*"
            element={
              <div className="boot-screen">
                <h1>Workspace not found</h1>
                <a className="primary-button" href="/">
                  Return to command center
                </a>
              </div>
            }
          />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

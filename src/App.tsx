import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/system/AppShell';
const CommandCenter = lazy(() => import('./pages/CommandCenter'));
const Events = lazy(() => import('./pages/Events'));
const EventDetail = lazy(() => import('./pages/EventDetail'));
const Downscaling = lazy(() => import('./pages/Downscaling'));
const Impact = lazy(() => import('./pages/Impact'));
const Alerts = lazy(() => import('./pages/Alerts'));
const APIExplorer = lazy(() => import('./pages/APIExplorer'));

export default function App() {
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
          <Route path="/replay" element={<CommandCenter replay />} />
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

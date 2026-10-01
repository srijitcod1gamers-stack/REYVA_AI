import { lazy, Suspense, useEffect, useState } from 'react';
import {
  Activity,
  Box,
  ChevronDown,
  CloudRain,
  GitCompareArrows,
  Globe2,
  Maximize2,
  Radio,
  ShieldCheck,
  Wind,
} from 'lucide-react';
import { useWeather } from '../providers/WeatherProvider';
import { EventFeed } from '../components/events/EventFeed';
import { EventIntelligence } from '../components/events/EventIntelligence';
import { TimelineController } from '../components/timeline/TimelineController';
import { LayerManager, MapLegend } from '../components/map/LayerManager';
import { ReplayBanner } from '../components/weather/ReplayBanner';
import { providerMode } from '../services/weather';
const MapCanvas = lazy(() => import('../components/map/MapCanvas'));

export default function CommandCenter({ replay = false }: { replay?: boolean }) {
  const w = useWeather(),
    [mobileTab, setMobileTab] = useState('map'),
    [focus, setFocus] = useState(false);
  useEffect(() => {
    w.setReplay(replay);
    if (replay) {
      w.selectEvent('WX-024');
      w.setHour(72);
    }
  }, [replay]);
  useEffect(() => {
    if (w.selected.provenance.kind === 'forecast') {
      w.setMode('meteorology');
      w.setAiField('none');
      w.setCompare(false);
    }
  }, [w.selected.provenance.kind]);
  return (
    <div className={`command-center ${focus ? 'map-focused' : ''} mobile-${mobileTab}`}>
      <div className="workspace-bar">
        <div className="workspace-title">
          <span className="workspace-status" />
          <h1>
            {replay
              ? 'Historical event replay'
              : providerMode === 'live'
                ? 'Live forecast screening'
                : 'Forecast intelligence'}
          </h1>
          <span className="workspace-slash">/</span>
          <button onClick={() => w.setCommandOpen(true)}>
            Indian Ocean basin <ChevronDown size={12} />
          </button>
        </div>
        <div className="mode-switch" role="group" aria-label="Application mode">
          <button
            className={w.mode === 'meteorology' ? 'active' : ''}
            onClick={() => w.setMode('meteorology')}
          >
            <Activity size={13} />
            <span>Meteorology</span>
          </button>
          {w.selected.provenance.kind === 'simulated' && (
            <button
              className={w.mode === 'response' ? 'active response' : ''}
              onClick={() => w.setMode('response')}
            >
              <ShieldCheck size={13} />
              <span>Disaster response</span>
            </button>
          )}
        </div>
        <span className="workspace-freshness">
          <span className="status-dot" />
          Forecast valid{' '}
          <b>
            {new Date(w.frame.timestamp).toLocaleString('en-GB', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'UTC',
            })}{' '}
            UTC
          </b>
        </span>
      </div>
      {replay && <ReplayBanner />}
      <div className="mobile-tabs">
        <button className={mobileTab === 'map' ? 'active' : ''} onClick={() => setMobileTab('map')}>
          4D map
        </button>
        <button
          className={mobileTab === 'events' ? 'active' : ''}
          onClick={() => setMobileTab('events')}
        >
          Signals · {w.events.length}
        </button>
        <button
          className={mobileTab === 'detail' ? 'active' : ''}
          onClick={() => setMobileTab('detail')}
        >
          Intelligence
        </button>
      </div>
      <div className="command-workspace">
        <div className="map-column">
          <div className="map-stage">
            <Suspense
              fallback={
                <div className="map-loading">
                  <div className="loading-line" />
                  Initializing WebGL map…
                </div>
              }
            >
              <MapCanvas
                resolution={
                  w.aiField === 'original'
                    ? 12
                    : w.aiField === 'interpolation'
                      ? 6
                      : w.aiField === 'ai'
                        ? 5
                        : undefined
                }
              />
            </Suspense>
            <div className="map-vignette" />
            <EventFeed />
            <div className="map-top-toolbar">
              <div className="weather-tabs" aria-label="Weather variable">
                {[
                  { id: 'rainfall', label: 'Rainfall', icon: CloudRain },
                  { id: 'wind', label: 'Wind', icon: Wind },
                  {
                    id: w.frame.grid ? 'pressure' : w.frame.samples?.length ? 'temperature' : 'anomaly',
                    label: w.frame.grid
                      ? 'Pressure'
                      : w.frame.samples?.length
                        ? 'Temperature'
                        : 'Anomaly',
                    icon: Activity,
                  },
                ].map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    className={w.variable === id && w.aiField === 'none' ? 'active' : ''}
                    onClick={() => {
                      w.setAiField('none');
                      w.setVariable(id as 'rainfall' | 'wind' | 'pressure' | 'temperature' | 'anomaly');
                    }}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
              <button
                className="map-pill focus-button"
                aria-label={focus ? 'Restore panels' : 'Expand map'}
                onClick={() => setFocus(!focus)}
              >
                <Maximize2 size={15} />
              </button>
            </div>
            <div className="map-coordinate-label">
              <span>20° N</span>
              <i />
              <span>80° E</span>
            </div>
            <div className="map-domain-label">
              <Globe2 size={12} />
              <span>INDIAN OCEAN · {w.replay ? 'REPLAY' : 'GEFS REGIONAL DOMAIN'}</span>
            </div>
            {w.compare && (
              <div className="comparison-key panel">
                <GitCompareArrows size={14} />
                <span>Current 00Z</span>
                <i />
                <span>Previous 18Z</span>
              </div>
            )}
            <div className="map-lower-toolbar">
              <LayerManager />
              <div className="map-view-switch">
                {(
                  [
                    { id: '2d', label: '2D' },
                    { id: '3d', label: '3D' },
                    { id: 'atmosphere', label: 'Intensity' },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.id}
                    title={
                      v.id === '3d'
                        ? 'Tilt geographic view'
                        : v.id === 'atmosphere'
                          ? 'Extrude rainfall intensity (height encodes intensity, not altitude)'
                          : 'Flat geographic view'
                    }
                    className={w.view === v.id ? 'active' : ''}
                    onClick={() => w.setView(v.id)}
                  >
                    {v.id === 'atmosphere' && <Box size={12} />} {v.label}
                  </button>
                ))}
              </div>
            </div>
            <MapLegend />
            <div className="map-inspect-hint">
              <CrosshairIcon /> Click anywhere to inspect local risk
            </div>
          </div>
          <TimelineController />
        </div>
        <EventIntelligence />
      </div>
    </div>
  );
}
function CrosshairIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <circle cx="8" cy="8" r="4" />
      <path d="M8 0v4m0 8v4M0 8h4m8 0h4" />
    </svg>
  );
}

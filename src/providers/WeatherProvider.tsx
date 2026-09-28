import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Coordinate,
  ForecastFrame,
  LocationRisk,
  WeatherEvent,
  WeatherVariable,
} from '../../shared/types';
import { provider } from '../services/weather';
import { clamp } from '../../shared/simulation';

export type LayerId =
  | 'risk'
  | 'trajectory'
  | 'ensemble'
  | 'wind'
  | 'population'
  | 'hospitals'
  | 'roads'
  | 'rivers'
  | 'agriculture'
  | 'topography'
  | 'boundaries'
  | 'districts';
export interface WeatherState {
  events: WeatherEvent[];
  selected: WeatherEvent;
  frame: ForecastFrame;
  hour: number;
  setHour: (hour: number) => void;
  selectEvent: (id: string) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
  replay: boolean;
  setReplay: (v: boolean) => void;
  mode: 'meteorology' | 'response';
  setMode: (v: 'meteorology' | 'response') => void;
  variable: WeatherVariable;
  setVariable: (v: WeatherVariable) => void;
  layers: Set<LayerId>;
  toggleLayer: (v: LayerId) => void;
  view: '2d' | '3d' | 'atmosphere';
  setView: (v: '2d' | '3d' | 'atmosphere') => void;
  compare: boolean;
  setCompare: (v: boolean) => void;
  aiField: 'none' | 'original' | 'interpolation' | 'ai';
  setAiField: (v: 'none' | 'original' | 'interpolation' | 'ai') => void;
  location: LocationRisk | null;
  inspectLocation: (v: Coordinate, name?: string) => void;
  clearLocation: () => void;
  commandOpen: boolean;
  setCommandOpen: (v: boolean) => void;
  notify: (message: string) => void;
  toast: string;
  error: string | null;
  retry: () => void;
  units: 'metric' | 'imperial';
  setUnits: (v: 'metric' | 'imperial') => void;
}
const Context = createContext<WeatherState | null>(null);
export function WeatherProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<WeatherEvent[]>([]),
    [selectedId, setSelectedId] = useState('WX-024');
  const [frame, setFrame] = useState<ForecastFrame | null>(null),
    [hour, updateHour] = useState(96);
  const [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [replay, setReplay] = useState(false);
  const [mode, setMode] = useState<'meteorology' | 'response'>('meteorology'),
    [variable, setVariable] = useState<WeatherVariable>('rainfall');
  const [layers, setLayers] = useState(new Set<LayerId>(['risk', 'trajectory', 'wind', 'boundaries']));
  const [view, setView] = useState<'2d' | '3d' | 'atmosphere'>('2d'),
    [compare, setCompare] = useState(false);
  const [aiField, setAiField] = useState<'none' | 'original' | 'interpolation' | 'ai'>('none');
  const [location, setLocation] = useState<LocationRisk | null>(null),
    [locationQuery, setLocationQuery] = useState<{ coordinates: Coordinate; name: string } | null>(null);
  const [commandOpen, setCommandOpen] = useState(false),
    [toast, setToast] = useState(''),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const [units, setUnits] = useState<'metric' | 'imperial'>('metric');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = events.find((e) => e.id === selectedId) ?? events[0];
  const setHour = useCallback((h: number) => updateHour(clamp(h, 72, 240)), []);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 4200);
  }, []);
  const toggleLayer = useCallback(
    (id: LayerId) =>
      setLayers((old) => {
        const next = new Set(old);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    provider
      .getEvents(controller.signal)
      .then((data) => {
        setEvents(data);
        setError(data.length ? null : 'No events returned by this provider.');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e.message));
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    provider
      .getFrame(selected, hour, replay, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setFrame(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(String(e.message));
          setPlaying(false);
        }
      });
    return () => controller.abort();
  }, [selected, hour, replay, revision]);
  useEffect(() => {
    if (!locationQuery || !selected) return;
    const controller = new AbortController();
    provider
      .getRisk(locationQuery.coordinates, locationQuery.name, selected, hour, replay, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setLocation(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) notify(e.message);
      });
    return () => controller.abort();
  }, [locationQuery, selected, hour, replay, notify]);
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(
      () =>
        updateHour((h) => {
          if (h >= 240) {
            setPlaying(false);
            return 240;
          }
          return Math.min(240, h + 1);
        }),
      350 / speed,
    );
    return () => clearInterval(interval);
  }, [playing, speed]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
      if (e.key === 'Escape') setCommandOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    if (mode === 'response') setLayers((old) => new Set([...old, 'population', 'hospitals', 'roads']));
  }, [mode]);
  const value = useMemo<WeatherState | null>(
    () =>
      selected && frame
        ? {
            events,
            selected,
            frame,
            hour,
            setHour,
            selectEvent: (id) => {
              setSelectedId(id);
              setLocation(null);
              setLocationQuery(null);
            },
            playing,
            setPlaying,
            speed,
            setSpeed,
            replay,
            setReplay,
            mode,
            setMode,
            variable,
            setVariable,
            layers,
            toggleLayer,
            view,
            setView,
            compare,
            setCompare,
            aiField,
            setAiField,
            location,
            inspectLocation: (
              coordinates,
              name = `${coordinates[1].toFixed(3)}°N, ${coordinates[0].toFixed(3)}°E`,
            ) => setLocationQuery({ coordinates, name }),
            clearLocation: () => {
              setLocationQuery(null);
              setLocation(null);
            },
            commandOpen,
            setCommandOpen,
            notify,
            toast,
            error,
            retry: () => setRevision((v) => v + 1),
            units,
            setUnits,
          }
        : null,
    [
      events,
      selected,
      frame,
      hour,
      setHour,
      playing,
      speed,
      replay,
      mode,
      variable,
      layers,
      toggleLayer,
      view,
      compare,
      aiField,
      location,
      commandOpen,
      notify,
      toast,
      error,
      units,
    ],
  );
  if (!value)
    return (
      <main className="boot-screen">
        <img src="/favicon.svg" width="52" height="52" alt="" />
        <h1>
          Weather Intelligence <span>AI</span>
        </h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="primary-button" onClick={() => setRevision((v) => v + 1)}>
              Retry connection
            </button>
          </>
        ) : (
          <>
            <div className="loading-line" />
            <p>Initializing geospatial intelligence…</p>
          </>
        )}
      </main>
    );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useWeather() {
  const context = useContext(Context);
  if (!context) throw new Error('Weather context unavailable');
  return context;
}

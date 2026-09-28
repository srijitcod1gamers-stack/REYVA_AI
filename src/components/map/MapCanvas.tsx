import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map as LibreMap, type StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { Compass, Crosshair, Minus, Plus, RotateCcw } from 'lucide-react';
import { useWeather } from '../../providers/WeatherProvider';
import { createLayers } from './layers';
import { WindField } from './WindField';
import type { Coordinate } from '../../../shared/types';
import 'maplibre-gl/dist/maplibre-gl.css';

const style: StyleSpecification = {
  version: 8,
  sources: {
    countries: {
      type: 'geojson',
      data: '/geo/countries-region.geojson',
      attribution: '© Natural Earth · boundaries for visualization',
    },
    states: { type: 'geojson', data: '/geo/states-region.geojson' },
    rivers: { type: 'geojson', data: '/geo/rivers-region.geojson' },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#101c25' } },
    {
      id: 'land',
      type: 'fill',
      source: 'countries',
      paint: { 'fill-color': '#26343a', 'fill-opacity': 0.62 },
    },
    {
      id: 'coastline',
      type: 'line',
      source: 'countries',
      paint: { 'line-color': '#566a73', 'line-width': 0.8, 'line-opacity': 0.66 },
    },
    {
      id: 'state-boundaries',
      type: 'line',
      source: 'states',
      paint: { 'line-color': '#53656c', 'line-width': 0.6, 'line-opacity': 0.54 },
    },
    {
      id: 'river-lines',
      type: 'line',
      source: 'rivers',
      layout: { visibility: 'none' },
      paint: { 'line-color': '#5184a2', 'line-width': 1, 'line-opacity': 0.75 },
    },
  ],
};
interface Props {
  compact?: boolean;
  resolution?: number;
  syncView?: { lng: number; lat: number; zoom: number };
  onViewChange?: (v: { lng: number; lat: number; zoom: number }) => void;
}
export default function MapCanvas({ compact = false, resolution, syncView, onViewChange }: Props) {
  const w = useWeather(),
    container = useRef<HTMLDivElement>(null),
    [map, setMap] = useState<LibreMap | null>(null),
    [ready, setReady] = useState(false),
    [mapError, setMapError] = useState('');
  const overlay = useRef<MapboxOverlay | null>(null),
    selectedRef = useRef(w.selected.id),
    pickRef = useRef(w.inspectLocation),
    viewCallback = useRef(onViewChange);
  pickRef.current = w.inspectLocation;
  viewCallback.current = onViewChange;
  const pick = useCallback((c: Coordinate, name: string) => pickRef.current(c, name), []);
  useEffect(() => {
    if (!container.current) return;
    let instance: LibreMap;
    try {
      instance = new maplibregl.Map({
        container: container.current,
        style,
        center: compact ? w.frame.centroid : [82.8, 21.5],
        zoom: compact ? 5.35 : container.current.clientWidth < 600 ? 3.6 : 4.25,
        minZoom: 2,
        maxZoom: 12,
        maxPitch: 60,
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
        fadeDuration: 250,
      });
      instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
      const deck = new MapboxOverlay({
        interleaved: false,
        layers: [],
        useDevicePixels: Math.min(devicePixelRatio, 2),
      });
      instance.addControl(deck);
      overlay.current = deck;
      instance.on('load', () => {
        setReady(true);
        setMapError('');
        const tiles =
          import.meta.env.VITE_BASEMAP_TILES ||
          'https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png';
        if (tiles && !instance.getSource('context')) {
          instance.addSource('context', {
            type: 'raster',
            tiles: [tiles],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors © CARTO',
            maxzoom: 18,
          });
          instance.addLayer(
            {
              id: 'context-tiles',
              type: 'raster',
              source: 'context',
              paint: { 'raster-opacity': 0.34, 'raster-saturation': -1 },
            },
            'land',
          );
        }
      });
      instance.on('error', (event) => {
        const msg = event.error?.message ?? '';
        if (/WebGL|context lost/i.test(msg))
          setMapError('WebGL unavailable. Enable hardware acceleration and reload.');
      });
      instance.on('click', (event) => {
        if (!compact) pickRef.current([event.lngLat.lng, event.lngLat.lat]);
      });
      instance.on('moveend', () => {
        const c = instance.getCenter();
        viewCallback.current?.({ lng: c.lng, lat: c.lat, zoom: instance.getZoom() });
      });
      setMap(instance);
      const observer = new ResizeObserver(() => instance.resize());
      observer.observe(container.current);
      return () => {
        observer.disconnect();
        instance.remove();
        overlay.current = null;
      };
    } catch {
      setMapError(
        'Your browser could not initialize WebGL. Enable hardware acceleration to view the interactive map.',
      );
    }
  }, []);
  const layers = useMemo(
    () =>
      createLayers({
        frame: w.frame,
        event: w.selected,
        events: w.events,
        variable: w.variable,
        visible: compact ? new Set(['boundaries']) : w.layers,
        compare: w.compare,
        view: w.view,
        onPick: pick,
        resolution,
      }),
    [w.frame, w.selected, w.events, w.variable, w.layers, w.compare, w.view, pick, compact, resolution],
  );
  useEffect(() => {
    overlay.current?.setProps({ layers });
  }, [layers, ready]);
  useEffect(() => {
    if (!map || !ready) return;
    map.setLayoutProperty(
      'state-boundaries',
      'visibility',
      w.layers.has('boundaries') ? 'visible' : 'none',
    );
    map.setLayoutProperty('river-lines', 'visibility', w.layers.has('rivers') ? 'visible' : 'none');
  }, [map, ready, w.layers]);
  useEffect(() => {
    if (!map || selectedRef.current === w.selected.id || compact) return;
    selectedRef.current = w.selected.id;
    map.flyTo({
      center: [w.selected.centroid[0] - 2.4, w.selected.centroid[1] + 1],
      zoom: 5,
      duration: 1500,
    });
  }, [map, w.selected, compact]);
  useEffect(() => {
    if (map && w.location && !compact)
      map.flyTo({
        center: [w.location.coordinates[0] - 1.1, w.location.coordinates[1]],
        zoom: 6,
        duration: 1200,
      });
  }, [map, w.location?.name, compact]);
  useEffect(() => {
    if (!map || !ready || compact) return;
    if (w.view === '3d') {
      if (!map.getSource('terrain')) {
        map.addSource('terrain', {
          type: 'raster-dem',
          url: import.meta.env.VITE_TERRAIN_TILES || 'https://tiles.mapterhorn.com/tilejson.json',
          tileSize: 512,
          attribution: 'Elevation © Mapterhorn',
        });
        map.addLayer(
          {
            id: 'terrain-shade',
            type: 'hillshade',
            source: 'terrain',
            paint: {
              'hillshade-exaggeration': 0.35,
              'hillshade-shadow-color': '#09131b',
              'hillshade-highlight-color': '#76919a',
            },
          },
          'coastline',
        );
      } else map.setLayoutProperty('terrain-shade', 'visibility', 'visible');
      map.setTerrain({ source: 'terrain', exaggeration: 1 });
    } else {
      map.setTerrain(null);
      if (map.getLayer('terrain-shade')) map.setLayoutProperty('terrain-shade', 'visibility', 'none');
    }
    map.easeTo({ pitch: w.view === '2d' ? 0 : 48, bearing: w.view === '2d' ? 0 : -12, duration: 900 });
  }, [map, ready, w.view, compact]);
  useEffect(() => {
    if (!map || !syncView) return;
    const c = map.getCenter();
    if (
      Math.abs(c.lng - syncView.lng) > 0.00001 ||
      Math.abs(c.lat - syncView.lat) > 0.00001 ||
      Math.abs(map.getZoom() - syncView.zoom) > 0.00001
    )
      map.jumpTo({ center: [syncView.lng, syncView.lat], zoom: syncView.zoom });
  }, [map, syncView]);
  return (
    <div className={`map-canvas ${compact ? 'compact-map' : ''}`}>
      <div
        ref={container}
        className="maplibre-container"
        aria-label="Interactive weather intelligence map"
      />
      {!compact && <WindField map={map} center={w.frame.centroid} enabled={w.layers.has('wind')} />}
      {!ready && !mapError && (
        <div className="map-loading">
          <div className="loading-line" />
          <span>Loading geographic layers…</span>
        </div>
      )}
      {mapError && (
        <div className="map-error" role="alert">
          {mapError}
          <button className="secondary-button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
      {!compact && (
        <div className="map-controls">
          <button
            aria-label="Reset north"
            title="Reset north"
            onClick={() => map?.easeTo({ bearing: 0, pitch: 0 })}
          >
            <Compass size={18} />
            <small>N</small>
          </button>
          <div />
          <button aria-label="Zoom in" title="Zoom in" onClick={() => map?.zoomIn()}>
            <Plus size={18} />
          </button>
          <button aria-label="Zoom out" title="Zoom out" onClick={() => map?.zoomOut()}>
            <Minus size={18} />
          </button>
          <div />
          <button
            aria-label="Center selected event"
            title="Center selected event"
            onClick={() =>
              map?.flyTo({
                center: [w.frame.centroid[0] - 2.4, w.frame.centroid[1] + 1],
                zoom: 5,
                duration: 900,
              })
            }
          >
            <Crosshair size={17} />
          </button>
          <button
            aria-label="Reset domain view"
            title="Reset domain view"
            onClick={() => map?.flyTo({ center: [82.8, 21.5], zoom: 4.25, pitch: 0, bearing: 0 })}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

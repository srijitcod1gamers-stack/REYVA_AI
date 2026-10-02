import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map as LibreMap, type StyleSpecification } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import { Compass, Crosshair, Minus, Plus, RotateCcw } from 'lucide-react';
import { useWeather } from '../../providers/WeatherProvider';
import { createLayers } from './layers';
import { WindField } from './WindField';
import type { Coordinate, ValidatedRainfallGrid } from '../../../shared/types';
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
  focus?: boolean;
  resolution?: number;
  rainfallGrid?: ValidatedRainfallGrid;
  syncView?: { lng: number; lat: number; zoom: number };
  onViewChange?: (v: { lng: number; lat: number; zoom: number }) => void;
  facilities?: { coordinates: Coordinate; name: string; kind: string }[];
}
export default function MapCanvas({
  compact = false,
  focus = false,
  resolution,
  rainfallGrid,
  syncView,
  onViewChange,
  facilities,
}: Props) {
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
        center: compact || focus ? w.frame.centroid : [82.8, 21.5],
        zoom: compact || focus ? 5.35 : container.current.clientWidth < 600 ? 3.6 : 4.25,
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
        getTooltip: ({ object }) =>
          object?.kind && object?.name ? `${object.name}\n${object.kind}` : null,
      });
      instance.addControl(deck);
      overlay.current = deck;
      instance.on('load', () => {
        setReady(true);
        setMapError('');
        const maptilerKey = import.meta.env.VITE_MAPTILER_KEY;
        const tiles =
          import.meta.env.VITE_BASEMAP_TILES ||
          (maptilerKey
            ? `https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png?key=${encodeURIComponent(maptilerKey)}`
            : '');
        if (tiles && !instance.getSource('context')) {
          instance.addSource('context', {
            type: 'raster',
            tiles: [tiles],
            tileSize: 256,
            attribution: maptilerKey ? '© MapTiler © OpenStreetMap contributors' : 'Custom basemap',
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
    () => [
      ...createLayers({
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
      ...(facilities
        ? [
            new ScatterplotLayer({
              id: 'mapped-exposed-facilities',
              data: facilities,
              pickable: true,
              getPosition: (item: NonNullable<Props['facilities']>[number]) => item.coordinates,
              getFillColor: [139, 223, 202, 230],
              radiusUnits: 'pixels',
              getRadius: 4,
              stroked: true,
              getLineColor: [13, 27, 35, 255],
              lineWidthUnits: 'pixels',
              getLineWidth: 1,
            }),
          ]
        : []),
    ],
    [
      w.frame,
      w.selected,
      w.events,
      w.variable,
      w.layers,
      w.compare,
      w.view,
      pick,
      compact,
      resolution,
      facilities,
    ],
  );
  useEffect(() => {
    overlay.current?.setProps({ layers });
  }, [layers, ready]);
  useEffect(() => {
    if (!map || !ready || !rainfallGrid) return;
    if (rainfallGrid.width !== 64 || rainfallGrid.height !== 64 || rainfallGrid.values.length !== 64)
      return;
    const canvas = document.createElement('canvas');
    canvas.width = rainfallGrid.width;
    canvas.height = rainfallGrid.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < 64; y++) {
      if (rainfallGrid.values[y]?.length !== 64) return;
      for (let x = 0; x < 64; x++) {
        const value = rainfallGrid.values[63 - y][x];
        const intensity = Math.min(1, Math.max(0, value / 150));
        const index = (y * 64 + x) * 4;
        pixels.data[index] = Math.round(39 + 214 * intensity);
        pixels.data[index + 1] = Math.round(190 - 135 * intensity);
        pixels.data[index + 2] = Math.round(170 - 115 * intensity);
        pixels.data[index + 3] = value > 0 ? Math.round(100 + 135 * intensity) : 0;
      }
    }
    context.putImageData(pixels, 0, 0);
    const [west, south, east, north] = rainfallGrid.bounds;
    const source = map.getSource('validated-rainfall');
    if (source) map.removeLayer('validated-rainfall-layer');
    if (source) map.removeSource('validated-rainfall');
    map.addSource('validated-rainfall', {
      type: 'image',
      url: canvas.toDataURL('image/png'),
      coordinates: [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ],
    });
    map.addLayer({
      id: 'validated-rainfall-layer',
      type: 'raster',
      source: 'validated-rainfall',
      paint: { 'raster-opacity': 0.8, 'raster-resampling': 'nearest' },
    });
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 24, duration: 500 },
    );
    return () => {
      if (map.getLayer('validated-rainfall-layer')) map.removeLayer('validated-rainfall-layer');
      if (map.getSource('validated-rainfall')) map.removeSource('validated-rainfall');
    };
  }, [map, ready, rainfallGrid]);
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
        aria-label="Interactive REYVA AI weather map"
      />
      {!compact && w.selected.provenance.kind === 'simulated' && (
        <WindField map={map} center={w.frame.centroid} enabled={w.layers.has('wind')} />
      )}
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

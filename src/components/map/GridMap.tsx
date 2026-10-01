import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import type { ScalarGrid } from '../../../shared/types';
import 'maplibre-gl/dist/maplibre-gl.css';

export function GridMap({ grid, label }: { grid: ScalarGrid; label: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!container.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = grid.longitudes.length;
    canvas.height = grid.latitudes.length;
    const ctx = canvas.getContext('2d')!;
    const pixels = ctx.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const value = grid.values[canvas.height - 1 - y][x];
        if (value === null) continue;
        const t = Math.min(1, value / 100),
          i = (y * canvas.width + x) * 4;
        pixels.data.set(
          [
            Math.round(35 + 220 * t),
            Math.round(170 - 100 * t),
            Math.round(190 - 130 * t),
            value === 0 ? 0 : 210,
          ],
          i,
        );
      }
    ctx.putImageData(pixels, 0, 0);
    const dx = (grid.longitudes[1] - grid.longitudes[0]) / 2,
      dy = (grid.latitudes[1] - grid.latitudes[0]) / 2;
    const west = grid.longitudes[0] - dx,
      south = grid.latitudes[0] - dy,
      east = grid.longitudes.at(-1)! + dx,
      north = grid.latitudes.at(-1)! + dy;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: {
          version: 8,
          sources: {
            land: { type: 'geojson', data: '/geo/countries-region.geojson' },
            weather: {
              type: 'image',
              url: canvas.toDataURL(),
              coordinates: [
                [west, north],
                [east, north],
                [east, south],
                [west, south],
              ],
            },
          },
          layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#101c25' } },
            { id: 'land', source: 'land', type: 'fill', paint: { 'fill-color': '#26343a' } },
            {
              id: 'weather',
              source: 'weather',
              type: 'raster',
              paint: { 'raster-resampling': 'nearest', 'raster-opacity': 0.85 },
            },
            {
              id: 'coast',
              source: 'land',
              type: 'line',
              paint: { 'line-color': '#a7c9c5', 'line-width': 0.7 },
            },
          ],
        },
        bounds: [
          [west, south],
          [east, north],
        ],
        fitBoundsOptions: { padding: 20 },
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl(), 'top-right');
      const resize = new ResizeObserver(() => map.resize());
      resize.observe(container.current);
      return () => {
        resize.disconnect();
        map.remove();
      };
    } catch {
      setError('Enable browser hardware acceleration to display this grid.');
    }
  }, [grid]);
  return (
    <div className="dataset-grid-map">
      <div ref={container} aria-label={label} />
      <span className="map-data-tag">{label}</span>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

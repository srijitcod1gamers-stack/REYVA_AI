import type { Coordinate, ForecastFrame } from '../../shared/types';
import type { B2Env } from './b2';
import { readPublished } from './gridded';

export function pointInFootprint(point: Coordinate, polygons: ForecastFrame['polygons']): boolean {
  const insideRing = (ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[i],
        [xj, yj] = ring[j];
      if (y > point[1] !== yj > point[1] && point[0] < ((xj - x) * (point[1] - y)) / (yj - y) + x)
        inside = !inside;
    }
    return inside;
  };
  return polygons.some(
    (p) => insideRing(p.geometry.coordinates[0]) && !p.geometry.coordinates.slice(1).some(insideRing),
  );
}
type Asset = { id: string; name: string; kind: string; coordinates: Coordinate };
type Result = {
  assets: Asset[];
  counts: Record<string, number>;
  source: string;
  fetched_at: string;
  method: string;
  population: null;
};
const results = new Map<string, { expires: number; value: Result }>();
const pending = new Map<string, Promise<Result>>();
export async function assessExposure(frame: ForecastFrame, env: B2Env): Promise<Result> {
  const key = JSON.stringify(frame.polygons);
  const cached = results.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (pending.has(key)) return pending.get(key)!;
  const task = (async () => {
    const points = frame.polygons.flatMap((p) => p.geometry.coordinates[0]);
    let assets: Asset[] = [];
    let retrievedAt = new Date().toISOString();
    if (points.length) {
      const west = Math.min(...points.map((p) => p[0])),
        east = Math.max(...points.map((p) => p[0])),
        south = Math.min(...points.map((p) => p[1])),
        north = Math.max(...points.map((p) => p[1]));
      const catalog = await readPublished<{
        bounds: number[];
        retrieved_at: string;
        complete_query: boolean;
        tiles: Record<string, { key: string }>;
      }>(env, 'geojson/facilities/latest.json');
      if (!catalog.complete_query || Date.now() - Date.parse(catalog.retrieved_at) > 14 * 86400_000)
        throw new Error(
          'The facility snapshot is incomplete or overdue for refresh. No count has been published.',
        );
      if (
        west < catalog.bounds[0] ||
        south < catalog.bounds[1] ||
        east > catalog.bounds[2] ||
        north > catalog.bounds[3]
      )
        throw new Error('This footprint is outside the regional facility dataset coverage.');
      const keys = [];
      for (let lat = Math.floor(south / 5) * 5; lat <= north; lat += 5)
        for (let lon = Math.floor(west / 5) * 5; lon <= east; lon += 5) {
          const tile = catalog.tiles[`${lat}/${lon}`];
          if (tile) keys.push(tile.key);
        }
      if (keys.length > 35) throw new Error('Select a smaller footprint for the facility assessment.');
      const tiles = await Promise.all(keys.map((key) => readPublished<Asset[]>(env, key)));
      assets = tiles.flat().filter((item) => {
        const [lon, lat] = item.coordinates;
        return (
          lon >= west &&
          lon <= east &&
          lat >= south &&
          lat <= north &&
          pointInFootprint(item.coordinates, frame.polygons)
        );
      });
      retrievedAt = catalog.retrieved_at;
    }

    const value: Result = {
      assets,
      counts: assets.reduce<Record<string, number>>(
        (counts, a) => ({ ...counts, [a.kind]: (counts[a.kind] ?? 0) + 1 }),
        {},
      ),
      source: 'OpenStreetMap / Overpass regional snapshot in Backblaze B2',
      fetched_at: retrievedAt,
      method:
        'Facility representative point inside native-grid forecast footprint. Community mapping coverage is incomplete; this is potential exposure, not observed damage.',
      population: null,
    };
    if (results.size > 100) results.delete(results.keys().next().value!);
    results.set(key, { expires: Date.now() + 3600_000, value });
    return value;
  })();
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

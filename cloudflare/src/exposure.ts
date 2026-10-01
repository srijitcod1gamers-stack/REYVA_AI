import type { Coordinate, ForecastFrame } from '../../shared/types';

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
export async function assessExposure(frame: ForecastFrame): Promise<Result> {
  const key = JSON.stringify(frame.polygons);
  const cached = results.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  if (pending.has(key)) return pending.get(key)!;
  const task = (async () => {
    const points = frame.polygons.flatMap((p) => p.geometry.coordinates[0]);
    let assets: Asset[] = [];
    if (points.length) {
      const west = Math.min(...points.map((p) => p[0])),
        east = Math.max(...points.map((p) => p[0])),
        south = Math.min(...points.map((p) => p[1])),
        north = Math.max(...points.map((p) => p[1]));
      if ((east - west) * (north - south) > 12)
        throw new Error(
          'Footprint is too large for a public facility query. Select a smaller object or import a regional facility dataset.',
        );
      const query = `[out:json][timeout:20];nwr[amenity~"^(hospital|clinic|school|fire_station)$"](${south},${west},${north},${east});out center 10001;`;
      const response = await fetch('https://overpass.private.coffee/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'REYVA-AI-facility-assessment/1.0',
          Referer: 'https://reyva-ai.pages.dev',
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok)
        throw new Error(`Facility source unavailable (${response.status}); try again later.`);
      const body = (await response.json()) as {
        remark?: string;
        elements: {
          type: string;
          id: number;
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: Record<string, string>;
        }[];
      };
      if (body.remark || body.elements.length > 10000)
        throw new Error('Facility query was incomplete; no exposure count has been published.');
      assets = body.elements.flatMap((item) => {
        const lat = item.lat ?? item.center?.lat,
          lon = item.lon ?? item.center?.lon;
        if (lat === undefined || lon === undefined || !pointInFootprint([lon, lat], frame.polygons))
          return [];
        return [
          {
            id: `${item.type}/${item.id}`,
            name: item.tags?.name ?? `Unnamed ${item.tags?.amenity}`,
            kind: item.tags?.amenity ?? 'facility',
            coordinates: [lon, lat] as Coordinate,
          },
        ];
      });
    }
    const value: Result = {
      assets,
      counts: assets.reduce<Record<string, number>>(
        (counts, a) => ({ ...counts, [a.kind]: (counts[a.kind] ?? 0) + 1 }),
        {},
      ),
      source: 'OpenStreetMap / Overpass',
      fetched_at: new Date().toISOString(),
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

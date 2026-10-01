import type { Feature, Polygon } from 'geojson';
import type {
  ForecastFrame,
  ScalarGrid,
  WeatherEvent,
  WeatherMetrics,
  Severity,
  Alert,
  Coordinate,
} from '../../shared/types';
import { distanceKm } from '../../shared/simulation';
import { getB2Object, type B2Env } from './b2';

interface GridObject {
  centroid: Coordinate;
  area_km2: number;
  cells: number;
  peak: number;
  geometries: Polygon[];
}
interface Pack {
  hour: number;
  valid_time: string;
  initialization: string;
  source: string;
  ensemble_members: number;
  resolution_degrees: number;
  fields: { rainfall: ScalarGrid; wind: ScalarGrid; pressure: ScalarGrid };
  objects: { rainfall: GridObject[]; wind: GridObject[] };
}
interface Catalog {
  initialization: string;
  published_at: string;
  frames: { hour: number; key: string }[];
}
type Step = { pack: Pack; object: GridObject };
type Track = { id: string; hazard: 'rainfall' | 'wind'; steps: Step[] };
const emptyImpact = {
  population: 0,
  villages: 0,
  hospitals: 0,
  schools: 0,
  roads: 0,
  bridges: 0,
  croplandHa: 0,
  riverSections: 0,
};
const memory = new Map<string, { expires: number; body: unknown }>();
export async function readPublished<T>(env: B2Env, key: string): Promise<T> {
  const cached = memory.get(key);
  if (cached && cached.expires > Date.now()) return cached.body as T;
  const response = await getB2Object(env, key);
  if (!response.ok) throw new Error(`Published dataset unavailable (${response.status})`);
  const body = await response.json();
  if (memory.size > 24) memory.delete(memory.keys().next().value!);
  if (!key.startsWith('replay/'))
    memory.set(key, { expires: Date.now() + (key.endsWith('latest.json') ? 60_000 : 3600_000), body });
  return body as T;
}
const severity = (peak: number, hazard: string): Severity => {
  const limits = hazard === 'rainfall' ? [25, 50, 100] : [50, 75, 100];
  return peak >= limits[2]
    ? 'SEVERE'
    : peak >= limits[1]
      ? 'HIGH'
      : peak >= limits[0]
        ? 'MODERATE'
        : 'LOW';
};
function at(grid: ScalarGrid, coordinates: Coordinate): number {
  const nearest = (axis: number[], value: number) =>
    axis.reduce(
      (best, current, index) =>
        Math.abs(current - value) < Math.abs(axis[best] - value) ? index : best,
      0,
    );
  return (
    grid.values[nearest(grid.latitudes, coordinates[1])]?.[nearest(grid.longitudes, coordinates[0])] ?? 0
  );
}
function metrics(pack: Pack, position: Coordinate): WeatherMetrics {
  return {
    rainfall: at(pack.fields.rainfall, position),
    wind: at(pack.fields.wind, position),
    pressure: at(pack.fields.pressure, position),
    humidity: 0,
    temperature: 0,
    anomaly: 0,
  };
}
function overlap(a: GridObject, b: GridObject): boolean {
  const box = (o: GridObject) => {
    const points = o.geometries.flatMap((g) => g.coordinates.flat());
    return [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ];
  };
  const x = box(a),
    y = box(b);
  return x[0] <= y[2] && y[0] <= x[2] && x[1] <= y[3] && y[1] <= x[3];
}
export class GriddedWeather {
  private catalog!: Catalog;
  private packs: Pack[] = [];
  private tracks: Track[] = [];
  constructor(private env: B2Env) {}
  async load() {
    this.catalog = await readPublished<Catalog>(this.env, 'raster/live/latest.json');
    const age = Date.now() - Date.parse(this.catalog.initialization);
    if (!Number.isFinite(age) || age > 36 * 3600_000 || age < -3600_000)
      throw new Error('Published NOAA cycle is stale; refresh the gridded pipeline');
    this.packs = await Promise.all(
      this.catalog.frames.map((item) => readPublished<Pack>(this.env, item.key)),
    );
    this.packs.sort((a, b) => a.hour - b.hour);
    for (const hazard of ['rainfall', 'wind'] as const) {
      for (const pack of this.packs) {
        const used = new Set<string>();
        for (const object of pack.objects[hazard]) {
          const candidates = this.tracks
            .filter(
              (track) =>
                track.hazard === hazard &&
                !used.has(track.id) &&
                pack.hour - track.steps.at(-1)!.pack.hour <= 24,
            )
            .filter(
              (track) =>
                overlap(track.steps.at(-1)!.object, object) &&
                distanceKm(track.steps.at(-1)!.object.centroid, object.centroid) <= 500,
            )
            .sort(
              (a, b) =>
                distanceKm(a.steps.at(-1)!.object.centroid, object.centroid) -
                distanceKm(b.steps.at(-1)!.object.centroid, object.centroid),
            );
          let track = candidates[0];
          if (!track) {
            track = { id: `GRID-${hazard.toUpperCase()}-${this.tracks.length + 1}`, hazard, steps: [] };
            this.tracks.push(track);
          }
          track.steps.push({ pack, object });
          used.add(track.id);
        }
      }
    }
    if (!this.tracks.length)
      this.tracks.push({ id: 'GRID-RAIN-OUTLOOK', hazard: 'rainfall', steps: [] });
    return this;
  }
  provenance() {
    return {
      kind: 'forecast' as const,
      source: 'NOAA GEFS native regional grids',
      model: 'GEFS 0.25° · five-member mean',
      run: this.catalog.initialization,
      disclaimer:
        'Native-grid rainfall/wind threshold screening. Object association uses overlap and distance; model probability and AI validation are separate.',
    };
  }
  events(): WeatherEvent[] {
    return this.tracks
      .map((track) => {
        const peak = track.steps.reduce<Step | null>(
          (best, s) => (!best || s.object.peak > best.object.peak ? s : best),
          null,
        );
        return {
          id: track.id,
          type: track.hazard === 'rainfall' ? ('rainfall' as const) : ('cyclone' as const),
          name: peak
            ? `${track.hazard === 'rainfall' ? 'Rainfall' : 'Wind'} object ${track.id.split('-').at(-1)}`
            : 'Regional rainfall outlook',
          region: 'Indian Ocean / India grid',
          severity: severity(peak?.object.peak ?? 0, track.hazard),
          confidence: 0,
          status: peak ? 'Grid threshold exceeded' : 'No threshold exceedance',
          trend: 'stable' as const,
          leadTime: peak?.pack.hour ?? 72,
          centroid: peak?.object.centroid ?? ([83, 21] as Coordinate),
          trajectory: track.steps.map(({ pack, object }) => ({
            hour: pack.hour,
            coordinates: object.centroid,
            timestamp: pack.valid_time,
            confidence: 0,
            severity: severity(object.peak, track.hazard),
            metrics: metrics(pack, object.centroid),
          })),
          provenance: this.provenance(),
          updatedAt: this.catalog.published_at,
        };
      })
      .sort(
        (a, b) =>
          ['SEVERE', 'HIGH', 'MODERATE', 'LOW'].indexOf(a.severity) -
          ['SEVERE', 'HIGH', 'MODERATE', 'LOW'].indexOf(b.severity),
      );
  }
  frame(id: string, hour: number): ForecastFrame {
    const track = this.tracks.find((item) => item.id === id);
    if (!track) throw new Error('Event not found');
    const pack = this.packs.reduce((best, p) =>
      Math.abs(p.hour - hour) < Math.abs(best.hour - hour) ? p : best,
    );
    const step = track.steps.find((s) => s.pack.hour === pack.hour);
    const centroid =
      step?.object.centroid ?? track.steps[0]?.object.centroid ?? ([83, 21] as Coordinate);
    const polygons: Feature<Polygon, ForecastFrame['polygons'][number]['properties']>[] = (
      step?.object.geometries ?? []
    ).map((geometry) => ({
      type: 'Feature',
      geometry,
      properties: {
        eventId: id,
        severity: severity(step!.object.peak, track.hazard),
        probability: 0,
        label: 'Threshold exceedance cells',
      },
    }));
    return {
      hour: pack.hour,
      timestamp: pack.valid_time,
      centroid,
      confidence: 0,
      severity: severity(step?.object.peak ?? 0, track.hazard),
      metrics: metrics(pack, centroid),
      polygons,
      ensemble: {
        total: pack.ensemble_members,
        agreeing: 0,
        spreadKm: 0,
        probability: 0,
        confidence: 0,
        trend: 0,
      },
      impact: emptyImpact,
      grid: { fields: pack.fields, resolution_degrees: pack.resolution_degrees, source: pack.source },
      availableHours: this.packs.map((p) => p.hour),
      areaKm2: step?.object.area_km2 ?? 0,
      detected: Boolean(step),
      initializedAt: this.catalog.initialization,
      publishedAt: this.catalog.published_at,
    };
  }
  alerts(): Alert[] {
    return this.events()
      .filter((event) => event.severity !== 'LOW')
      .map((event) => {
        const frame = this.frame(event.id, event.leadTime);
        return {
          id: `ALERT-${event.id}`,
          eventId: event.id,
          title: event.name + ' threshold advisory',
          region: event.region,
          coordinates: frame.centroid,
          severity: frame.severity,
          confidence: 0,
          leadHours: frame.hour,
          timestamp: this.catalog.published_at,
          forecastWindow: frame.timestamp,
          rainfall: frame.metrics.rainfall,
          wind: frame.metrics.wind,
          population: 0,
          polygon: frame.polygons[0],
          acknowledged: false,
          provenance: event.provenance,
        };
      });
  }
  risk(coordinates: Coordinate, id: string, hour: number, name: string) {
    const frame = this.frame(id, hour);
    const field = frame.grid!.fields.rainfall!;
    if (
      coordinates[0] < field.longitudes[0] ||
      coordinates[0] > field.longitudes.at(-1)! ||
      coordinates[1] < field.latitudes[0] ||
      coordinates[1] > field.latitudes.at(-1)!
    )
      return null;
    const values = { rainfall: at(field, coordinates), wind: at(frame.grid!.fields.wind!, coordinates) };
    const hazard = this.tracks.find((track) => track.id === id)!.hazard;
    return {
      name,
      coordinates,
      eventId: id,
      severity: severity(hazard === 'wind' ? values.wind : values.rainfall, hazard),
      probability: null,
      confidence: null,
      rainfall: { min: values.rainfall, max: values.rainfall },
      wind: values.wind,
      arrivalHours: [frame.hour, frame.hour],
      distanceKm: Math.round(distanceKm(coordinates, frame.centroid)),
      impact: 'Nearest native forecast grid cell; no calibrated local flood probability.',
      provenance: this.provenance(),
    };
  }
}

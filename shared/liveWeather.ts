import { downscaling } from './fixtures';
import { clamp, distanceKm, frameFor, irregularRing, riskFor } from './simulation';
import type {
  Alert,
  Coordinate,
  ForecastFrame,
  LocationRisk,
  Severity,
  TrajectoryPoint,
  WeatherDataProvider,
  WeatherEvent,
  WeatherMetrics,
} from './types';

// A sparse regional screening grid. It is not a native NWP raster or a cyclone tracker.
const sites: { name: string; region: string; coordinates: Coordinate }[] = [
  { name: 'Bay of Bengal south', region: 'Bay of Bengal', coordinates: [86, 12] },
  { name: 'Bay of Bengal central', region: 'Bay of Bengal', coordinates: [87, 16] },
  { name: 'Bay of Bengal north', region: 'Bay of Bengal', coordinates: [88, 20] },
  { name: 'Odisha coast', region: 'East coast', coordinates: [85, 20] },
  { name: 'West Bengal coast', region: 'East coast', coordinates: [88, 22] },
  { name: 'Andhra coast', region: 'East coast', coordinates: [82, 17] },
  { name: 'Tamil Nadu coast', region: 'East coast', coordinates: [80, 13] },
  { name: 'Arabian Sea', region: 'Arabian Sea', coordinates: [70, 17] },
  { name: 'Mumbai coast', region: 'West coast', coordinates: [73, 19] },
  { name: 'Goa coast', region: 'West coast', coordinates: [74, 15] },
  { name: 'Kerala coast', region: 'West coast', coordinates: [76, 10] },
  { name: 'Gujarat', region: 'Northwest India', coordinates: [72, 23] },
  { name: 'Rajasthan', region: 'Northwest India', coordinates: [74, 27] },
  { name: 'Delhi region', region: 'North India', coordinates: [77, 29] },
  { name: 'Central India', region: 'Central India', coordinates: [78, 23] },
  { name: 'Eastern India', region: 'Eastern India', coordinates: [85, 25] },
];

type Hourly = Record<string, Array<number | string | null>> & { time: string[] };
type Point = { latitude: number; longitude: number; hourly: Hourly };
type Hazard = 'rainfall' | 'wind' | 'heat';
type Snapshot = { site: number; hour: number; score: number; metrics: WeatherMetrics; spread: number };
const model = 'ncep_gefs025_ensemble_mean';
const variables = [
  'precipitation',
  'precipitation_spread',
  'wind_gusts_10m',
  'wind_gusts_10m_spread',
  'temperature_2m',
  'temperature_2m_spread',
  'pressure_msl',
  'relative_humidity_2m',
];
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
const source = 'NOAA GEFS 0.25° via Open-Meteo';
const disclaimer =
  'Live ensemble forecast sampled at 16 sites. Footprints and local risk are screening estimates, not validated AI output or official warnings.';
const numberAt = (h: Hourly, key: string, index: number) => Number(h[key]?.[index] ?? 0);
const iso = (value: string) => `${value}Z`;

function scoreOf(metrics: WeatherMetrics, hazard: Hazard) {
  if (hazard === 'rainfall') return Math.max(0, metrics.rainfall / 65);
  if (hazard === 'wind')
    return Math.max(0, metrics.wind / 75) + Math.max(0, (1005 - metrics.pressure) / 35);
  return Math.max(0, (metrics.temperature - 36) / 8);
}
function severityOf(score: number): Severity {
  return score >= 1.65 ? 'SEVERE' : score >= 1.1 ? 'HIGH' : score >= 0.65 ? 'MODERATE' : 'LOW';
}
function metricsAt(point: Point, index: number): WeatherMetrics {
  const h = point.hourly;
  const rainfall = Array.from({ length: 24 }, (_, offset) =>
    numberAt(h, 'precipitation', Math.max(0, index - offset)),
  ).reduce((a, b) => a + b, 0);
  return {
    rainfall: Math.round(rainfall),
    wind: Math.round(numberAt(h, 'wind_gusts_10m', index)),
    pressure: Math.round(numberAt(h, 'pressure_msl', index)),
    humidity: Math.round(numberAt(h, 'relative_humidity_2m', index)),
    temperature: Math.round(numberAt(h, 'temperature_2m', index) * 10) / 10,
    anomaly: 0, // No historical climatology is connected; do not invent an EFI.
  };
}
function ringFrame(event: WeatherEvent, hour: number, points: Point[] = []): ForecastFrame {
  const point = event.trajectory.reduce((best, item) =>
    Math.abs(item.hour - hour) < Math.abs(best.hour - hour) ? item : best,
  );
  const severity = point.severity;
  const radius = severity === 'SEVERE' ? 1.25 : severity === 'HIGH' ? 1 : 0.7;
  const confidence = point.confidence;
  const nearest = points.reduce<Point | null>(
    (best, sample) =>
      !best ||
      distanceKm([sample.longitude, sample.latitude], point.coordinates) <
        distanceKm([best.longitude, best.latitude], point.coordinates)
        ? sample
        : best,
    null,
  );
  return {
    hour,
    timestamp: point.timestamp,
    centroid: point.coordinates,
    confidence,
    severity,
    metrics: point.metrics,
    polygons: (['MODERATE', 'HIGH', severity] as Severity[]).map((level, index) => ({
      type: 'Feature',
      properties: {
        eventId: event.id,
        severity: level,
        probability: 0,
        label: 'Approximate screening footprint',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [irregularRing(point.coordinates, radius * [1.8, 1.1, 0.55][index], hour)],
      },
    })),
    ensemble: {
      total: nearest ? 31 : 0,
      agreeing: 0,
      spreadKm: 0,
      probability: 0,
      confidence,
      trend: 0,
    },
    impact: emptyImpact,
    samples: points.map((sample) => ({
      coordinates: [sample.longitude, sample.latitude],
      metrics: metricsAt(sample, Math.min(239, hour)),
    })),
    ensembleSpread: nearest
      ? {
          precipitationHourly:
            Math.round(numberAt(nearest.hourly, 'precipitation_spread', Math.min(239, hour)) * 10) / 10,
          windGust: Math.round(numberAt(nearest.hourly, 'wind_gusts_10m_spread', Math.min(239, hour))),
          temperature:
            Math.round(numberAt(nearest.hourly, 'temperature_2m_spread', Math.min(239, hour)) * 10) / 10,
        }
      : undefined,
  };
}

export class LiveWeatherProvider implements WeatherDataProvider {
  private points: Point[] = [];
  private events: WeatherEvent[] = [];
  private loaded = 0;
  private pending: Promise<WeatherEvent[]> | null = null;

  private async load(): Promise<WeatherEvent[]> {
    if (this.events.length && Date.now() - this.loaded < 30 * 60_000) return this.events;
    if (this.pending) return this.pending;
    this.pending = this.fetchEvents().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetchEvents(): Promise<WeatherEvent[]> {
    const url = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
    url.searchParams.set('latitude', sites.map((s) => s.coordinates[1]).join(','));
    url.searchParams.set('longitude', sites.map((s) => s.coordinates[0]).join(','));
    url.searchParams.set('hourly', variables.join(','));
    url.searchParams.set('models', model);
    url.searchParams.set('forecast_days', '10');
    url.searchParams.set('timezone', 'GMT');
    url.searchParams.set('cell_selection', 'nearest');
    const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!response.ok)
      throw new Error(
        `Live forecast source returned ${response.status}. Try again later or open historical replay.`,
      );
    const data: Point[] = await response.json();
    if (
      !Array.isArray(data) ||
      data.length !== sites.length ||
      !data.every((p) => p.hourly?.time?.length >= 216)
    )
      throw new Error('Live ensemble response was incomplete. Refresh to retry.');
    this.points = data;
    const hazards: { kind: Hazard; id: string; name: string; type: WeatherEvent['type'] }[] = [
      { kind: 'rainfall', id: 'LIVE-RAIN', name: 'Heavy rainfall signal', type: 'rainfall' },
      { kind: 'wind', id: 'LIVE-WIND', name: 'Wind & pressure signal', type: 'cyclone' },
      { kind: 'heat', id: 'LIVE-HEAT', name: 'Heat signal', type: 'heat' },
    ];
    this.events = hazards
      .map(({ kind, id, name, type }) => {
        const snapshots: Snapshot[] = [];
        for (const hour of [...Array.from({ length: 28 }, (_, index) => 72 + index * 6), 239]) {
          const candidates = data.map((point, site) => {
            const metrics = metricsAt(point, hour);
            return {
              site,
              hour,
              metrics,
              score: scoreOf(metrics, kind),
              spread: numberAt(
                point.hourly,
                `${kind === 'rainfall' ? 'precipitation' : kind === 'wind' ? 'wind_gusts_10m' : 'temperature_2m'}_spread`,
                hour,
              ),
            };
          });
          snapshots.push(candidates.sort((a, b) => b.score - a.score)[0]);
        }
        const peak = snapshots.reduce((best, item) => (item.score > best.score ? item : best));
        const trajectory: TrajectoryPoint[] = snapshots.map((item) => ({
          hour: item.hour,
          coordinates: sites[item.site].coordinates,
          timestamp: iso(data[item.site].hourly.time[item.hour]),
          confidence: Math.round(clamp((item.score / 1.65) * 100, 0, 100)),
          severity: severityOf(item.score),
          metrics: item.metrics,
        }));
        const severity = severityOf(peak.score);
        const run = iso(data[0].hourly.time[0]);
        return {
          id,
          type,
          name,
          region: sites[peak.site].region,
          severity,
          confidence: trajectory.find((p) => p.hour === peak.hour)?.confidence ?? 50,
          status: severity === 'LOW' ? 'Monitoring' : 'Screening signal',
          trend: 'stable' as const,
          leadTime: peak.hour,
          centroid: sites[peak.site].coordinates,
          trajectory,
          provenance: {
            kind: 'forecast' as const,
            source,
            model: 'GEFS 0.25° ensemble mean',
            run,
            disclaimer,
          },
          updatedAt: new Date().toISOString(),
        };
      })
      .sort(
        (a, b) =>
          ['SEVERE', 'HIGH', 'MODERATE', 'LOW'].indexOf(a.severity) -
          ['SEVERE', 'HIGH', 'MODERATE', 'LOW'].indexOf(b.severity),
      );
    this.loaded = Date.now();
    return this.events;
  }

  getEvents(_signal?: AbortSignal) {
    return this.load();
  }
  async getFrame(
    event: WeatherEvent,
    hour: number,
    replay: boolean,
    signal?: AbortSignal,
  ): Promise<ForecastFrame> {
    if (replay) {
      return frameFor(event, hour, true);
    }
    await this.load();
    return ringFrame(event, hour, this.points);
  }
  async getRisk(
    coordinates: Coordinate,
    name: string,
    event: WeatherEvent,
    hour: number,
    replay: boolean,
    signal?: AbortSignal,
  ): Promise<LocationRisk> {
    if (replay) {
      return riskFor(coordinates, name, event, hour, true);
    }
    const url = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
    url.searchParams.set('latitude', String(coordinates[1]));
    url.searchParams.set('longitude', String(coordinates[0]));
    url.searchParams.set('hourly', variables.join(','));
    url.searchParams.set('models', model);
    url.searchParams.set('forecast_days', '10');
    url.searchParams.set('timezone', 'GMT');
    const response = await fetch(url, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error('Could not retrieve the coordinate forecast.');
    const point: Point = await response.json();
    const metrics = metricsAt(point, Math.min(239, Math.max(72, hour)));
    const kind: Hazard =
      event.type === 'rainfall' ? 'rainfall' : event.type === 'heat' ? 'heat' : 'wind';
    const severity = severityOf(scoreOf(metrics, kind));
    const distance = distanceKm(coordinates, ringFrame(event, hour).centroid);
    return {
      name,
      coordinates,
      eventId: event.id,
      severity,
      probability: 0,
      rainfall: { min: metrics.rainfall, max: metrics.rainfall },
      wind: metrics.wind,
      arrivalHours: [hour, hour + 6],
      confidence: 0,
      distanceKm: Math.round(distance),
      impact:
        'Forecast screening at this coordinate. Probability and local impacts require calibrated models.',
      provenance: event.provenance,
    };
  }
  async getAlerts(signal?: AbortSignal): Promise<Alert[]> {
    const events = await this.load();
    return events
      .filter((event) => event.severity !== 'LOW')
      .map((event) => {
        const frame = ringFrame(event, event.leadTime);
        return {
          id: `ALERT-${event.id}`,
          eventId: event.id,
          title: `${event.name} screening advisory`,
          region: event.region,
          coordinates: frame.centroid,
          severity: frame.severity,
          confidence: 0,
          leadHours: event.leadTime,
          timestamp: event.updatedAt,
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
  async getDownscaling() {
    return downscaling.filter((item) => item.id !== 'ai');
  }
}

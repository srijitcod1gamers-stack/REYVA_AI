import type {
  Alert,
  Coordinate,
  ForecastDelta,
  ForecastFrame,
  LocationRisk,
  RiskPolygon,
  Severity,
  TrajectoryPoint,
  WeatherEvent,
  WeatherMetrics,
} from './types';

export const MIN_HOUR = 72;
export const MAX_HOUR = 240;
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export function timeAt(hour: number, replay = false) {
  return new Date(
    Date.parse(replay ? '2020-05-14T00:00:00Z' : '2026-09-27T00:00:00Z') + hour * 3600000,
  ).toISOString();
}
export function centerAt(center: Coordinate, type: WeatherEvent['type'], hour: number): Coordinate {
  const t = (clamp(hour, 72, 240) - 96) / 144;
  return type === 'cyclone'
    ? [center[0] + t * 1.4 + Math.sin(t * 3) * 0.35, center[1] + t * 6.6]
    : [center[0] + t * 0.65, center[1] + t * (type === 'rainfall' ? 2 : -0.4)];
}
export function metricsAt(type: WeatherEvent['type'], hour: number): WeatherMetrics {
  const strength = 0.65 + Math.sin(((clamp(hour, 72, 240) - 72) / 168) * Math.PI) * 0.55;
  return {
    rainfall: Math.round((type === 'cyclone' ? 195 : type === 'rainfall' ? 168 : 12) * strength),
    wind: Math.round((type === 'cyclone' ? 132 : 36) * strength),
    pressure: Math.round(1012 - (type === 'cyclone' ? 42 : 10) * strength),
    humidity: Math.round(clamp(73 + strength * 13, 0, 100)),
    temperature: Number(
      (type === 'heat' ? 39 + strength * 6 : type === 'cold' ? -3 - strength * 4 : 27.4).toFixed(1),
    ),
    anomaly: Math.round(strength * 62),
  };
}
export function trajectoryFor(center: Coordinate, type: WeatherEvent['type']): TrajectoryPoint[] {
  return Array.from({ length: 29 }, (_, i) => {
    const hour = 72 + i * 6;
    return {
      hour,
      coordinates: centerAt(center, type, hour),
      timestamp: timeAt(hour),
      confidence: Math.round(clamp(91 - i * 0.7, 50, 99)),
      severity: (i > 5 && i < 20 ? 'SEVERE' : 'HIGH') as Severity,
      metrics: metricsAt(type, hour),
    };
  });
}
export function irregularRing(
  center: Coordinate,
  radius: number,
  hour = 96,
  elongation = 1.25,
): Coordinate[] {
  const points: Coordinate[] = Array.from({ length: 80 }, (_, i) => {
    const a = (i / 80) * Math.PI * 2;
    const r = radius * (1 + Math.sin(a * 3 + hour / 100) * 0.15 + Math.cos(a * 5 - hour / 90) * 0.08);
    return [
      center[0] + Math.cos(a) * r + Math.sin(a) * r * 0.28,
      center[1] + Math.sin(a) * r * elongation,
    ];
  });
  return [...points, points[0]];
}
export function frameFor(event: WeatherEvent, hour: number, replay = false): ForecastFrame {
  hour = clamp(hour, 72, 240);
  const centroid = centerAt(event.centroid, event.type, hour);
  const metrics = metricsAt(event.type, hour);
  const phase = Math.sin(((hour - 72) / 168) * Math.PI);
  const confidence = Math.round(
    clamp(event.confidence + Math.sin((hour - 96) / 55) * 4 - Math.max(0, hour - 144) / 11, 35, 96),
  );
  const severity: Severity =
    event.type === 'cyclone' ? (hour >= 90 && hour <= 192 ? 'SEVERE' : 'HIGH') : event.severity;
  const radius = (event.type === 'cyclone' ? 1.38 : 0.95) * (0.8 + phase * 0.35);
  const polygons: RiskPolygon[] = (['MODERATE', 'HIGH', severity] as Severity[]).map((s, i) => ({
    type: 'Feature',
    properties: {
      eventId: event.id,
      severity: s,
      probability: (confidence - (2 - i) * 9) / 100,
      label:
        i === 2
          ? `${s.charAt(0)}${s.slice(1).toLowerCase()} core zone`
          : ['Moderate-risk zone', 'High-risk zone'][i],
    },
    geometry: {
      type: 'Polygon',
      coordinates: [irregularRing(centroid, radius * [1.7, 1.05, 0.56][i], hour)],
    },
  }));
  return {
    hour,
    timestamp: timeAt(hour, replay),
    centroid,
    confidence,
    severity,
    metrics,
    polygons,
    ensemble: {
      total: 23,
      agreeing: Math.round((confidence / 100) * 23),
      spreadKm: Math.round(39 + (hour - 72) * 0.43),
      confidence,
      probability: (confidence - 3) / 100,
      trend: hour < 144 ? 4 : -3,
    },
    impact: {
      population: Math.round((64000 + phase * 112000) / 100) * 100,
      villages: Math.round(12 + phase * 12),
      hospitals: Math.round(2 + phase * 2),
      schools: Math.round(15 + phase * 14),
      roads: Math.round(1 + phase * 2),
      bridges: Math.round(2 + phase * 4),
      croplandHa: Math.round(4800 + phase * 7200),
      riverSections: Math.round(2 + phase * 4),
    },
  };
}
export function distanceKm(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180,
    p =
      Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
      Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(p), Math.sqrt(Math.max(0, 1 - p)));
}
export function riskFor(
  coordinates: Coordinate,
  name: string,
  event: WeatherEvent,
  hour: number,
  replay = false,
): LocationRisk {
  const frame = frameFor(event, hour, replay),
    distance = distanceKm(coordinates, frame.centroid);
  const strength = Math.exp(-distance / 260),
    probability = Math.round(frame.confidence * strength) / 100;
  const severity: Severity =
    probability > 0.7 ? 'SEVERE' : probability > 0.45 ? 'HIGH' : probability > 0.18 ? 'MODERATE' : 'LOW';
  return {
    name,
    coordinates,
    eventId: event.id,
    severity,
    probability,
    rainfall: {
      min: Math.round(frame.metrics.rainfall * strength * 0.8),
      max: Math.round(frame.metrics.rainfall * strength * 1.2),
    },
    wind: Math.round(frame.metrics.wind * strength),
    arrivalHours: [
      Math.max(0, event.leadTime - (hour - 96)),
      Math.max(6, event.leadTime - (hour - 96) + 6),
    ],
    confidence: frame.confidence,
    distanceKm: Math.round(distance),
    impact:
      severity === 'LOW'
        ? 'Limited modeled exposure to this event'
        : 'Potential localized flooding, strong winds, and transport disruption',
    provenance: { ...event.provenance, run: replay ? '2020-05-14T00:00:00Z' : event.provenance.run },
  };
}
export function deltaFor(frame: ForecastFrame): ForecastDelta {
  const current = Math.round(frame.ensemble.probability * 100);
  return {
    previous: current - 21,
    current,
    change: 21,
    shiftKm: 31,
    direction: 'northwest',
    arrivalDeltaHours: -6,
    populationDelta: 28400,
    previousSeverity: 'HIGH',
    currentSeverity: frame.severity,
  };
}
export function alertsFor(events: WeatherEvent[]): Alert[] {
  return events.map((e, i) => {
    const f = frameFor(e, 96);
    return {
      id: `ALT-${String(1048 + i)}`,
      eventId: e.id,
      title: `${e.name} advisory`,
      region: e.region,
      coordinates: f.centroid,
      severity: f.severity,
      confidence: f.confidence,
      leadHours: e.leadTime,
      timestamp: e.updatedAt,
      forecastWindow: f.timestamp,
      rainfall: f.metrics.rainfall,
      wind: f.metrics.wind,
      population: f.impact.population,
      polygon: f.polygons[1],
      acknowledged: false,
      provenance: e.provenance,
    };
  });
}

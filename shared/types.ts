import type { Feature, Polygon } from 'geojson';

export type Severity = 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
export type WeatherVariable =
  'rainfall' | 'temperature' | 'wind' | 'pressure' | 'humidity' | 'anomaly' | 'ensemble';
export type Coordinate = [number, number];
export type DataKind = 'simulated' | 'forecast' | 'observed' | 'ai-generated' | 'interpolated';
export interface Provenance {
  kind: DataKind;
  source: string;
  model: string;
  run: string;
  disclaimer: string;
}
export interface WeatherMetrics {
  rainfall: number;
  wind: number;
  pressure: number;
  humidity: number;
  temperature: number;
  anomaly: number;
}
export interface TrajectoryPoint {
  hour: number;
  coordinates: Coordinate;
  timestamp: string;
  confidence: number;
  severity: Severity;
  metrics: WeatherMetrics;
}
export interface EnsembleSummary {
  total: number;
  agreeing: number;
  spreadKm: number;
  probability: number;
  confidence: number;
  trend: number;
}
export interface ImpactAssessment {
  population: number;
  villages: number;
  hospitals: number;
  schools: number;
  roads: number;
  bridges: number;
  croplandHa: number;
  riverSections: number;
}
export interface RiskProperties {
  eventId: string;
  severity: Severity;
  probability: number;
  label: string;
}
export type RiskPolygon = Feature<Polygon, RiskProperties>;
export interface ForecastFrame {
  hour: number;
  timestamp: string;
  centroid: Coordinate;
  confidence: number;
  severity: Severity;
  metrics: WeatherMetrics;
  polygons: RiskPolygon[];
  ensemble: EnsembleSummary;
  impact: ImpactAssessment;
  samples?: { coordinates: Coordinate; metrics: WeatherMetrics }[];
  ensembleSpread?: { precipitationHourly: number; windGust: number; temperature: number };
}
export interface WeatherEvent {
  id: string;
  type: 'cyclone' | 'rainfall' | 'heat' | 'cold';
  name: string;
  region: string;
  severity: Severity;
  confidence: number;
  status: string;
  trend: 'intensifying' | 'stable' | 'weakening';
  leadTime: number;
  centroid: Coordinate;
  trajectory: TrajectoryPoint[];
  provenance: Provenance;
  updatedAt: string;
}
export interface ForecastDelta {
  previous: number;
  current: number;
  change: number;
  shiftKm: number;
  direction: string;
  arrivalDeltaHours: number;
  populationDelta: number;
  previousSeverity: Severity;
  currentSeverity: Severity;
}
export interface LocationRisk {
  name: string;
  coordinates: Coordinate;
  eventId: string;
  severity: Severity;
  probability: number;
  rainfall: { min: number; max: number };
  wind: number;
  arrivalHours: [number, number];
  confidence: number;
  distanceKm: number;
  impact: string;
  provenance: Provenance;
}
export interface Alert {
  id: string;
  eventId: string;
  title: string;
  region: string;
  coordinates: Coordinate;
  severity: Severity;
  confidence: number;
  leadHours: number;
  timestamp: string;
  forecastWindow: string;
  rainfall: number;
  wind: number;
  population: number;
  polygon: RiskPolygon;
  acknowledged: boolean;
  provenance: Provenance;
}
export interface ModelMetric {
  label: string;
  value: number;
  unit: string;
}
export interface DownscalingResult {
  id: 'original' | 'interpolation' | 'ai';
  label: string;
  resolution: number;
  peakRainfall: number;
  wind: number;
  variance: number;
  percentile99: number;
  rmse: number;
  mae: number;
  extremeError: number;
  similarity: number;
  kind: DataKind;
}
export interface ValidatedRainfallGrid {
  event_id: string;
  hour: number;
  valid_time: string;
  variable: 'accumulated_precipitation_mm';
  accumulation_hours: number;
  resolution_degrees: number;
  method: string;
  source: string;
  validation: {
    model_mae_mm: number;
    baseline_mae_mm: number;
    model_p99_error_mm: number;
    baseline_p99_error_mm: number;
    cases: number;
  };
  bounds: [number, number, number, number];
  width: number;
  height: number;
  values: number[][];
}
export interface Infrastructure {
  id: string;
  name: string;
  type: 'hospital' | 'settlement' | 'school';
  coordinates: Coordinate;
  population?: number;
}
export interface WeatherDataProvider {
  getEvents(signal?: AbortSignal): Promise<WeatherEvent[]>;
  getFrame(
    event: WeatherEvent,
    hour: number,
    replay: boolean,
    signal?: AbortSignal,
  ): Promise<ForecastFrame>;
  getRisk(
    coordinates: Coordinate,
    name: string,
    event: WeatherEvent,
    hour: number,
    replay: boolean,
    signal?: AbortSignal,
  ): Promise<LocationRisk>;
  getAlerts(signal?: AbortSignal): Promise<Alert[]>;
  getDownscaling(signal?: AbortSignal): Promise<DownscalingResult[]>;
}

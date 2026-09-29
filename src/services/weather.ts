import { events, downscaling } from '../../shared/fixtures';
import { alertsFor, frameFor, riskFor } from '../../shared/simulation';
import { LiveWeatherProvider } from '../../shared/liveWeather';
import type {
  Alert,
  Coordinate,
  DownscalingResult,
  ForecastFrame,
  LocationRisk,
  WeatherDataProvider,
  WeatherEvent,
} from '../../shared/types';

export class MockWeatherProvider implements WeatherDataProvider {
  async getEvents() {
    return structuredClone(events);
  }
  async getFrame(event: WeatherEvent, hour: number, replay: boolean) {
    return frameFor(event, hour, replay);
  }
  async getRisk(
    coordinates: Coordinate,
    name: string,
    event: WeatherEvent,
    hour: number,
    replay: boolean,
  ) {
    return riskFor(coordinates, name, event, hour, replay);
  }
  async getAlerts() {
    return alertsFor(events);
  }
  async getDownscaling() {
    return downscaling;
  }
}
export class ApiWeatherProvider implements WeatherDataProvider {
  constructor(private base: string) {}
  private async request<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      signal: signal ?? AbortSignal.timeout(12000),
    });
    if (!response.ok)
      throw new Error(`Weather service returned ${response.status}. Check the API connection.`);
    return response.json() as Promise<T>;
  }
  getEvents(signal?: AbortSignal) {
    return this.request<WeatherEvent[]>('/events', signal);
  }
  getFrame(event: WeatherEvent, hour: number, replay: boolean, signal?: AbortSignal) {
    return this.request<ForecastFrame>(
      `/forecast?event_id=${event.id}&hour=${hour}&replay=${replay}`,
      signal,
    );
  }
  getRisk(
    coordinates: Coordinate,
    name: string,
    event: WeatherEvent,
    hour: number,
    replay: boolean,
    signal?: AbortSignal,
  ) {
    return this.request<LocationRisk>(
      `/risk?lon=${coordinates[0]}&lat=${coordinates[1]}&name=${encodeURIComponent(name)}&event_id=${event.id}&hour=${hour}&replay=${replay}`,
      signal,
    );
  }
  getAlerts(signal?: AbortSignal) {
    return this.request<Alert[]>('/alerts', signal);
  }
  getDownscaling(signal?: AbortSignal) {
    return this.request<DownscalingResult[]>('/downscaled/WX-024', signal);
  }
}
export const provider =
  import.meta.env.VITE_DATA_PROVIDER === 'api'
    ? new ApiWeatherProvider(import.meta.env.VITE_API_BASE_URL || '/api')
    : import.meta.env.VITE_DATA_PROVIDER === 'demo'
      ? new MockWeatherProvider()
      : new LiveWeatherProvider();
export const providerMode =
  import.meta.env.VITE_DATA_PROVIDER === 'api'
    ? 'api'
    : import.meta.env.VITE_DATA_PROVIDER === 'demo'
      ? 'demo'
      : 'live';

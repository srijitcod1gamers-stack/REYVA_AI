import type { D1Database, R2Bucket, ExecutionContext } from '@cloudflare/workers-types';
import { demoApi } from '../../shared/api';
import { LiveWeatherProvider } from '../../shared/liveWeather';
import { distanceKm } from '../../shared/simulation';
import type { Coordinate, WeatherEvent } from '../../shared/types';

interface Env {
  MODE?: 'live' | 'demo';
  ALLOWED_ORIGIN?: string;
  WEATHER_ASSETS?: R2Bucket;
  WEATHER_DB?: D1Database;
}

const live = new LiveWeatherProvider();

function cors(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGIN || 'http://127.0.0.1:5173')
    .split(',')
    .map((value) => value.trim());
  return origin && allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {};
}
function json(request: Request, env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...cors(request, env),
    },
  });
}
function failure(request: Request, env: Env, message: string, status: number) {
  return json(request, env, { error: message }, status);
}
function validNumber(raw: string | null, min: number, max: number): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}
function forecastHour(url: URL): number | null {
  const raw = url.searchParams.get('hour');
  if (raw === null) return 96;
  const value = validNumber(raw, 72, 240);
  return value !== null && Number.isInteger(value) ? Math.min(value, 239) : null;
}
async function asset(request: Request, env: Env, url: URL) {
  if (!env.WEATHER_ASSETS) return failure(request, env, 'R2 assets are not configured', 503);
  const key = decodeURIComponent(url.pathname.slice('/api/assets/'.length));
  if (
    !key ||
    key.includes('..') ||
    key.startsWith('/') ||
    !/^(tiles|geojson|raster|replay|model-output)\/[a-zA-Z0-9/_.,@-]+$/.test(key)
  )
    return failure(request, env, 'Invalid object key', 400);
  const object = await env.WEATHER_ASSETS.get(key);
  if (!object) return failure(request, env, 'Asset not found', 404);
  return new Response(object.body as ReadableStream, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
      ETag: object.httpEtag,
      ...cors(request, env),
    },
  });
}
async function cacheMetadata(env: Env, path: string, body: unknown) {
  if (!env.WEATHER_DB || !Array.isArray(body) || !body.length) return;
  const now = new Date().toISOString();
  if (path === '/api/events') {
    await env.WEATHER_DB.batch(
      body.map((event: WeatherEvent) =>
        env
          .WEATHER_DB!.prepare(
            'INSERT INTO events (id, severity, region, updated_at, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET severity=excluded.severity, region=excluded.region, updated_at=excluded.updated_at, payload=excluded.payload',
          )
          .bind(event.id, event.severity, event.region, now, JSON.stringify(event)),
      ),
    );
  }
  if (path === '/api/alerts') {
    await env.WEATHER_DB.batch(
      body.map((alert: { id: string; eventId: string; severity: string }) =>
        env
          .WEATHER_DB!.prepare(
            'INSERT INTO alerts (id, event_id, severity, updated_at, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET severity=excluded.severity, updated_at=excluded.updated_at, payload=excluded.payload',
          )
          .bind(alert.id, alert.eventId, alert.severity, now, JSON.stringify(alert)),
      ),
    );
  }
}
function eventById(events: WeatherEvent[], id: string | null) {
  return id ? events.find((event) => event.id === id) : events[0];
}

async function liveApi(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const path = url.pathname;
  if (path === '/api/health')
    return json(request, env, {
      status: 'ok',
      mode: 'live',
      language: 'TypeScript',
      source: 'NOAA GEFS via Open-Meteo',
      forecast: '25 km ensemble mean sampled at 16 locations',
      trained_models: false,
    });
  if (path === '/api/events') {
    const events = await live.getEvents();
    ctx.waitUntil(cacheMetadata(env, path, events).catch(() => undefined));
    return json(request, env, events);
  }
  const events = await live.getEvents();
  if (path.startsWith('/api/events/')) {
    const event = eventById(events, path.slice('/api/events/'.length));
    return event ? json(request, env, event) : failure(request, env, 'Event not found', 404);
  }
  if (path.startsWith('/api/trajectory/')) {
    const event = eventById(events, path.slice('/api/trajectory/'.length));
    return event ? json(request, env, event.trajectory) : failure(request, env, 'Event not found', 404);
  }
  if (path === '/api/alerts') {
    const alerts = await live.getAlerts();
    ctx.waitUntil(cacheMetadata(env, path, alerts).catch(() => undefined));
    return json(request, env, alerts);
  }
  if (path === '/api/downscaled/WX-024' || path.startsWith('/api/downscaled/'))
    return failure(request, env, 'A validated 5 km downscaling model is not connected', 501);
  const hour = forecastHour(url);
  if (hour === null) return failure(request, env, 'hour must be an integer from 72 to 240', 400);
  const event = eventById(events, url.searchParams.get('event_id'));
  if (!event) return failure(request, env, 'Event not found', 404);
  if (path === '/api/forecast') return json(request, env, await live.getFrame(event, hour, false));
  if (path === '/api/risk' || path === '/api/live/risk') {
    const lat = validNumber(url.searchParams.get('lat'), -90, 90);
    const lon = validNumber(url.searchParams.get('lon'), -180, 180);
    if (lat === null || lon === null)
      return failure(request, env, 'Valid lat and lon are required', 400);
    const coordinates: Coordinate = [lon, lat];
    const risk = await live.getRisk(
      coordinates,
      url.searchParams.get('name') || 'Selected coordinates',
      event,
      hour,
      false,
    );
    return json(request, env, { ...risk, probability: null, confidence: null });
  }
  if (path === '/api/impact') {
    const frame = await live.getFrame(event, hour, false);
    const radius = Math.round(
      Math.max(
        ...frame.polygons[0].geometry.coordinates[0].map((point) =>
          distanceKm(frame.centroid, point as Coordinate),
        ),
      ),
    );
    return json(request, env, {
      event_id: event.id,
      timestamp: frame.timestamp,
      severity: frame.severity,
      radius_km_approximate: radius,
      area_km2_approximate: Math.round(Math.PI * radius * radius),
      footprint: frame.polygons[0],
      exposure: null,
      provenance: event.provenance,
    });
  }
  return failure(request, env, 'Endpoint not found', 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS')
      return new Response(null, {
        status: 204,
        headers: {
          ...cors(request, env),
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    if (request.method !== 'GET') return failure(request, env, 'Read-only API', 405);
    if (url.pathname.startsWith('/api/assets/')) return asset(request, env, url);
    if (url.pathname === '/api/cache/events' || url.pathname === '/api/cache/alerts') {
      if (!env.WEATHER_DB) return failure(request, env, 'D1 cache is not configured', 503);
      const table = url.pathname.endsWith('events') ? 'events' : 'alerts';
      const rows = await env.WEATHER_DB.prepare(
        `SELECT payload FROM ${table} ORDER BY updated_at DESC LIMIT 100`,
      ).all<{ payload: string }>();
      return json(
        request,
        env,
        rows.results.map((row) => JSON.parse(row.payload)),
      );
    }
    if (!url.pathname.startsWith('/api/')) return failure(request, env, 'Endpoint not found', 404);
    if (env.MODE === 'demo') {
      const result = demoApi(url);
      if (result.status === 200 && (url.pathname === '/api/events' || url.pathname === '/api/alerts'))
        ctx.waitUntil(cacheMetadata(env, url.pathname, result.body).catch(() => undefined));
      return json(request, env, result.body, result.status);
    }
    try {
      return await liveApi(request, env, url, ctx);
    } catch (error) {
      return json(
        request,
        env,
        {
          error: 'Live forecast source unavailable',
          detail: error instanceof Error ? error.message : 'unknown',
        },
        502,
      );
    }
  },
};

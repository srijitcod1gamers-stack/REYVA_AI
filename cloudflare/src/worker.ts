import type { D1Database, ExecutionContext } from '@cloudflare/workers-types';
import { demoApi } from '../../shared/api';
import { LiveWeatherProvider } from '../../shared/liveWeather';
import { distanceKm } from '../../shared/simulation';
import type { Coordinate, WeatherEvent } from '../../shared/types';
import { b2IsConfigured, getB2Object } from './b2';
import { GriddedWeather, readPublished } from './gridded';
import { assessExposure } from './exposure';

interface Env {
  MODE?: 'live' | 'demo';
  GRID_MODE?: 'published';
  ALLOWED_ORIGIN?: string;
  ML_API_ORIGIN?: string;
  ML_API_KEY?: string;
  ADMIN_API_TOKEN?: string;
  B2_ENDPOINT?: string;
  B2_REGION?: string;
  B2_BUCKET?: string;
  B2_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
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
  if (!b2IsConfigured(env)) return failure(request, env, 'Backblaze B2 assets are not configured', 503);
  const key = decodeURIComponent(url.pathname.slice('/api/assets/'.length));
  if (
    !key ||
    key.includes('..') ||
    key.startsWith('/') ||
    !/^(tiles|geojson|raster|replay|model-output)\/[a-zA-Z0-9/_.,@-]+$/.test(key)
  )
    return failure(request, env, 'Invalid object key', 400);
  let object: Response;
  try {
    object = await getB2Object(env, key);
  } catch (error) {
    return failure(
      request,
      env,
      error instanceof Error ? error.message : 'Backblaze B2 request failed',
      502,
    );
  }
  if (object.status === 404) return failure(request, env, 'Asset not found', 404);
  if (!object.ok) return failure(request, env, 'Backblaze B2 request failed', 502);
  return new Response(object.body, {
    headers: {
      'Content-Type': object.headers.get('Content-Type') || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
      ...(object.headers.get('ETag') ? { ETag: object.headers.get('ETag')! } : {}),
      ...(object.headers.get('Last-Modified')
        ? { 'Last-Modified': object.headers.get('Last-Modified')! }
        : {}),
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
    await env.WEATHER_DB.batch(
      body.map((event: WeatherEvent) =>
        env
          .WEATHER_DB!.prepare(
            'INSERT INTO trajectories (event_id, updated_at, payload) VALUES (?, ?, ?) ON CONFLICT(event_id) DO UPDATE SET updated_at=excluded.updated_at, payload=excluded.payload',
          )
          .bind(event.id, now, JSON.stringify(event.trajectory)),
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

function authenticated(request: Request, token?: string) {
  return Boolean(token && request.headers.get('Authorization') === `Bearer ${token}`);
}

async function mlRequest(request: Request, env: Env, path: string): Promise<Response> {
  if (!env.ML_API_ORIGIN || !env.ML_API_KEY)
    return failure(request, env, 'ML service is not configured', 503);
  const origin = new URL(env.ML_API_ORIGIN);
  if (
    origin.protocol !== 'https:' &&
    !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))
  )
    return failure(request, env, 'ML service URL must use HTTPS', 503);
  const upstream = new URL(path, `${origin.origin}/`);
  const response = await fetch(upstream, {
    headers: { 'X-Internal-Key': env.ML_API_KEY },
    signal: AbortSignal.timeout(25_000),
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'no-store',
      ...cors(request, env),
    },
  });
}

async function liveApi(request: Request, env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const path = url.pathname;
  if (path === '/api/replay') return json(request, env, await readPublished(env, 'replay/catalog.json'));
  if (/^\/api\/(replay|verification)\/[a-z0-9-]+$/.test(path)) {
    const id = path.split('/').at(-1)!;
    const catalog = await readPublished<{ cases: { id: string; key: string }[] }>(
      env,
      'replay/catalog.json',
    );
    const item = catalog.cases.find((item) => item.id === id);
    return item
      ? json(request, env, await readPublished(env, item.key))
      : failure(request, env, 'Historical case not found', 404);
  }
  if (path === '/api/datasets')
    return json(request, env, await readPublished(env, 'model-output/inventory.json'));
  if (path === '/api/ml/status' && !env.ML_API_ORIGIN) {
    return json(request, env, await readPublished(env, 'model-output/status.json'));
  }
  if (
    env.GRID_MODE === 'published' &&
    !path.startsWith('/api/ml/') &&
    !path.startsWith('/api/downscaled/')
  ) {
    const provider = await new GriddedWeather(env).load();
    const events = provider.events();
    if (path === '/api/health')
      return json(request, env, {
        status: 'ok',
        mode: 'live',
        language: 'TypeScript',
        source: 'NOAA GEFS native 0.25° grids',
        forecast: 'Regional native-grid threshold detection and object association',
        initialized_at: events[0].provenance.run,
        ml_service_configured: Boolean(env.ML_API_ORIGIN && env.ML_API_KEY),
      });
    if (path === '/api/events') {
      ctx.waitUntil(
        (async () => {
          await cacheMetadata(env, path, events);
          if (env.WEATHER_DB) {
            const frame = provider.frame(events[0].id, 72);
            const metadata = {
              initialization: frame.initializedAt,
              ensemble_members: frame.ensemble.total,
              resolution_degrees: frame.grid!.resolution_degrees,
              bounds: [68, 6, 98, 36],
              objects: events.length,
            };
            await env.WEATHER_DB.batch([
              env.WEATHER_DB.prepare(
                'INSERT INTO model_runs(id,initialized_at,model_name,source,status,metadata_json) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json,status=excluded.status',
              ).bind(
                `GEFS-${frame.initializedAt}`,
                frame.initializedAt,
                'GEFS 0.25° five-member mean',
                frame.grid!.source,
                'published native screening',
                JSON.stringify(metadata),
              ),
              env.WEATHER_DB.prepare(
                'INSERT INTO datasets(id,kind,storage_key,initialized_at,published_at,metadata_json) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET initialized_at=excluded.initialized_at,published_at=excluded.published_at,metadata_json=excluded.metadata_json',
              ).bind(
                'raster/live/latest.json',
                'live_catalog',
                'raster/live/latest.json',
                frame.initializedAt,
                frame.publishedAt,
                JSON.stringify(metadata),
              ),
            ]);
          }
        })(),
      );
      return json(request, env, events);
    }
    if (path === '/api/alerts') {
      const alerts = provider.alerts();
      ctx.waitUntil(cacheMetadata(env, path, alerts));
      return json(request, env, alerts);
    }
    if (path.startsWith('/api/events/')) {
      const event = eventById(events, path.slice('/api/events/'.length));
      return event ? json(request, env, event) : failure(request, env, 'Event not found', 404);
    }
    if (path.startsWith('/api/trajectory/')) {
      const event = eventById(events, path.slice('/api/trajectory/'.length));
      return event
        ? json(request, env, event.trajectory)
        : failure(request, env, 'Event not found', 404);
    }
    const event = eventById(events, url.searchParams.get('event_id'));
    if (!event) return failure(request, env, 'Event not found', 404);
    const hour = validNumber(url.searchParams.get('hour') ?? '96', 72, 240);
    if (hour === null) return failure(request, env, 'hour must be from 72 to 240', 400);
    if (path === '/api/forecast') return json(request, env, provider.frame(event.id, hour));
    if (path === '/api/exposure') {
      try {
        return json(request, env, await assessExposure(provider.frame(event.id, hour)));
      } catch (error) {
        return failure(
          request,
          env,
          error instanceof Error ? error.message : 'Facility assessment unavailable',
          503,
        );
      }
    }
    if (path === '/api/impact') {
      const frame = provider.frame(event.id, hour);
      return json(request, env, {
        event_id: event.id,
        timestamp: frame.timestamp,
        severity: frame.severity,
        area_km2: frame.areaKm2,
        footprints: frame.polygons,
        method: 'Sum of spherical areas of contiguous threshold-exceedance native grid cells',
        exposure: null,
        provenance: event.provenance,
      });
    }
    if (path === '/api/risk' || path === '/api/live/risk') {
      const lat = validNumber(url.searchParams.get('lat'), -90, 90),
        lon = validNumber(url.searchParams.get('lon'), -180, 180);
      if (lat === null || lon === null)
        return failure(request, env, 'Valid lat and lon are required', 400);
      const risk = provider.risk(
        [lon, lat],
        event.id,
        hour,
        url.searchParams.get('name') || 'Selected grid cell',
      );
      if (risk) return json(request, env, risk);
      return failure(
        request,
        env,
        'Location is outside the published 68–98°E, 6–36°N forecast domain. Expand the pipeline bounds to cover it.',
        422,
      );
    }
    return failure(request, env, 'Endpoint not found', 404);
  }
  if (path === '/api/health')
    return json(request, env, {
      status: 'ok',
      mode: 'live',
      language: 'TypeScript',
      source: 'NOAA GEFS via Open-Meteo',
      forecast: '25 km ensemble mean sampled at 16 locations',
      trained_models: null,
      ml_service_configured: Boolean(env.ML_API_ORIGIN && env.ML_API_KEY),
    });
  if (path === '/api/events') {
    const events = await live.getEvents();
    ctx.waitUntil(cacheMetadata(env, path, events).catch(() => undefined));
    return json(request, env, events);
  }
  if (path === '/api/ml/status') {
    const response = await mlRequest(request, env, 'v1/status');
    if (response.ok && env.WEATHER_DB) {
      const status = (await response.clone().json()) as {
        model?: {
          ready?: boolean;
          method?: string;
          checkpoint_sha256?: string;
          trained_at?: string;
        };
      };
      const model = status.model;
      if (model?.ready && model.checkpoint_sha256 && model.trained_at)
        ctx.waitUntil(
          env.WEATHER_DB.prepare(
            'INSERT INTO model_runs (id, initialized_at, model_name, source, status, metadata_json) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, metadata_json=excluded.metadata_json',
          )
            .bind(
              model.checkpoint_sha256,
              model.trained_at,
              model.method || 'conditional DDPM',
              'validated local artifact',
              'validated',
              JSON.stringify(status),
            )
            .run()
            .catch(() => undefined),
        );
    }
    return response;
  }
  if (path.startsWith('/api/ml/track/')) {
    const id = path.slice('/api/ml/track/'.length);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return failure(request, env, 'Invalid event ID', 400);
    const hour = forecastHour(url);
    if (hour === null) return failure(request, env, 'hour must be an integer from 72 to 240', 400);
    return mlRequest(request, env, `v1/track/${id}?hour=${hour}`);
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
  if (path.startsWith('/api/downscaled/')) {
    const id = path.slice('/api/downscaled/'.length);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return failure(request, env, 'Invalid event ID', 400);
    const hour = forecastHour(url);
    if (hour === null) return failure(request, env, 'hour must be an integer from 72 to 240', 400);
    const event = eventById(events, id);
    if (!event) return failure(request, env, 'Event not found', 404);
    return mlRequest(
      request,
      env,
      `v1/downscaled/${id}?hour=${hour}&lat=${event.centroid[1]}&lon=${event.centroid[0]}`,
    );
  }
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
    if (url.pathname.startsWith('/api/admin/')) {
      if (!authenticated(request, env.ADMIN_API_TOKEN))
        return failure(request, env, 'Unauthorized', 401);
      if (!env.WEATHER_DB) return failure(request, env, 'D1 is not configured', 503);
      const table = url.pathname.slice('/api/admin/'.length);
      if (!['events', 'alerts', 'trajectories', 'model-runs'].includes(table))
        return failure(request, env, 'Endpoint not found', 404);
      const query =
        table === 'model-runs'
          ? 'SELECT id, initialized_at, model_name, source, status, metadata_json FROM model_runs ORDER BY initialized_at DESC LIMIT 100'
          : `SELECT payload FROM ${table} ORDER BY updated_at DESC LIMIT 100`;
      const rows = await env.WEATHER_DB.prepare(query).all();
      return json(request, env, rows.results);
    }
    if (url.pathname.startsWith('/api/assets/')) return asset(request, env, url);
    if (url.pathname === '/api/cache/events' || url.pathname === '/api/cache/alerts') {
      if (!authenticated(request, env.ADMIN_API_TOKEN))
        return failure(request, env, 'Unauthorized', 401);
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

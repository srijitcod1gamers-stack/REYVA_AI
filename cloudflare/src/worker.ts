import type { D1Database, R2Bucket, ExecutionContext } from '@cloudflare/workers-types';
import { demoApi } from '../../shared/api';

interface Env {
  MODE: 'demo' | 'api';
  ALLOWED_ORIGIN: string;
  FASTAPI_ORIGIN: string;
  BACKEND_TOKEN?: string;
  WEATHER_ASSETS: R2Bucket;
  WEATHER_DB: D1Database;
}

function cors(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGIN.split(',').map((x) => x.trim());
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
async function asset(request: Request, env: Env, url: URL) {
  const key = decodeURIComponent(url.pathname.slice('/api/assets/'.length));
  if (
    !key ||
    key.includes('..') ||
    key.startsWith('/') ||
    !/^(tiles|geojson|raster|replay|model-output)\/[a-zA-Z0-9/_.,@-]+$/.test(key)
  )
    return json(request, env, { error: 'Invalid object key' }, 400);
  const object = await env.WEATHER_ASSETS.get(key);
  if (!object) return json(request, env, { error: 'Asset not found' }, 404);
  return new Response(object.body as ReadableStream, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
      ETag: object.httpEtag,
      ...cors(request, env),
    },
  });
}
async function cacheMetadata(env: Env, url: URL, body: unknown) {
  if (!env.WEATHER_DB) return;
  const now = new Date().toISOString();
  if (url.pathname === '/api/events' && Array.isArray(body)) {
    await env.WEATHER_DB.batch(
      body.map((e: Record<string, unknown>) =>
        env.WEATHER_DB.prepare(
          'INSERT INTO events (id, severity, region, updated_at, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET severity=excluded.severity, region=excluded.region, updated_at=excluded.updated_at, payload=excluded.payload',
        ).bind(e.id, e.severity, e.region, now, JSON.stringify(e)),
      ),
    );
  }
  if (url.pathname === '/api/alerts' && Array.isArray(body)) {
    await env.WEATHER_DB.batch(
      body.map((a: Record<string, unknown>) =>
        env.WEATHER_DB.prepare(
          'INSERT INTO alerts (id, event_id, severity, updated_at, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET severity=excluded.severity, updated_at=excluded.updated_at, payload=excluded.payload',
        ).bind(a.id, a.eventId, a.severity, now, JSON.stringify(a)),
      ),
    );
  }
}
async function proxy(request: Request, env: Env, url: URL, ctx: ExecutionContext) {
  if (!env.FASTAPI_ORIGIN) return json(request, env, { error: 'FASTAPI_ORIGIN is not configured' }, 503);
  const upstream = new URL(`${url.pathname}${url.search}`, env.FASTAPI_ORIGIN);
  const response = await fetch(upstream.toString(), {
    method: 'GET',
    headers: env.BACKEND_TOKEN ? { Authorization: `Bearer ${env.BACKEND_TOKEN}` } : {},
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const contentType = response.headers.get('Content-Type') || 'application/json';
  if (
    response.ok &&
    (url.pathname === '/api/events' || url.pathname === '/api/alerts') &&
    contentType.includes('json')
  ) {
    const clone = response.clone();
    ctx.waitUntil(
      clone
        .json()
        .then((body) => cacheMetadata(env, url, body))
        .catch(() => undefined),
    );
  }
  return new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store', ...cors(request, env) },
  });
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
    if (request.method !== 'GET') return json(request, env, { error: 'Read-only API' }, 405);
    if (url.pathname.startsWith('/api/assets/')) return asset(request, env, url);
    if (url.pathname === '/api/cache/events' || url.pathname === '/api/cache/alerts') {
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
    if (!url.pathname.startsWith('/api/'))
      return json(request, env, { error: 'Endpoint not found' }, 404);
    if (env.MODE === 'demo') {
      const result = demoApi(url);
      if (result.status === 200 && (url.pathname === '/api/events' || url.pathname === '/api/alerts'))
        ctx.waitUntil(cacheMetadata(env, url, result.body).catch(() => undefined));
      return json(request, env, result.body, result.status);
    }
    try {
      return await proxy(request, env, url, ctx);
    } catch (error) {
      return json(
        request,
        env,
        { error: 'Backend unavailable', detail: error instanceof Error ? error.message : 'unknown' },
        502,
      );
    }
  },
};

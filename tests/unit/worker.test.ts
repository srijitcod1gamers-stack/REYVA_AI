import { afterEach, expect, test, vi } from 'vitest';
import type { ExecutionContext } from '@cloudflare/workers-types';
import worker from '../../cloudflare/src/worker';

afterEach(() => vi.unstubAllGlobals());

test('TypeScript API serves live forecast screening without invented probabilities', async () => {
  const mlRequests: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.hostname === 'ml.example') {
        mlRequests.push(url);
        return new Response(JSON.stringify({ model: { ready: false } }), { status: 200 });
      }
      const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
      const lons = (url.searchParams.get('longitude') || '').split(',').map(Number);
      const start = Date.parse('2026-09-29T00:00:00Z');
      const time = Array.from({ length: 240 }, (_, hour) =>
        new Date(start + hour * 3600000).toISOString().slice(0, 16),
      );
      const points = lats.map((latitude, index) => ({
        latitude,
        longitude: lons[index],
        hourly: {
          time,
          precipitation: time.map(() => (index === 0 ? 7 : 2)),
          precipitation_spread: time.map(() => 1),
          wind_gusts_10m: time.map(() => 80),
          wind_gusts_10m_spread: time.map(() => 4),
          temperature_2m: time.map(() => 29),
          temperature_2m_spread: time.map(() => 1),
          pressure_msl: time.map(() => 1000),
          relative_humidity_2m: time.map(() => 80),
        },
      }));
      return new Response(JSON.stringify(points.length === 1 ? points[0] : points), { status: 200 });
    }),
  );
  const env = { MODE: 'live' as const, ALLOWED_ORIGIN: 'http://127.0.0.1:5173' };
  const context = { waitUntil: (_promise: Promise<unknown>) => undefined } as ExecutionContext;
  const request = (path: string) =>
    new Request(`http://localhost${path}`, { headers: { Origin: 'http://127.0.0.1:5173' } });

  const eventsResponse = await worker.fetch(request('/api/events'), env, context);
  expect(eventsResponse.status).toBe(200);
  const events = (await eventsResponse.json()) as Array<{ id: string; provenance: { kind: string } }>;
  expect(events).toHaveLength(3);
  expect(events[0].provenance.kind).toBe('forecast');

  const forecastResponse = await worker.fetch(
    request('/api/forecast?event_id=LIVE-RAIN&hour=96'),
    env,
    context,
  );
  const forecast = (await forecastResponse.json()) as {
    metrics: { rainfall: number };
    samples: unknown[];
  };
  expect(forecast.metrics.rainfall).toBe(168);
  expect(forecast.samples).toHaveLength(16);

  const riskResponse = await worker.fetch(
    request('/api/live/risk?lat=22.57&lon=88.36&hour=96'),
    env,
    context,
  );
  const risk = (await riskResponse.json()) as { probability: unknown; provenance: { kind: string } };
  expect(riskResponse.status).toBe(200);
  expect(risk.probability).toBeNull();
  expect(risk.provenance.kind).toBe('forecast');
  expect((await worker.fetch(request('/api/risk?lat=100&lon=88'), env, context)).status).toBe(400);
  expect((await worker.fetch(request('/api/downscaled/LIVE-RAIN'), env, context)).status).toBe(503);
  expect((await worker.fetch(request('/api/admin/events'), env, context)).status).toBe(401);
  const mlEnv = {
    ...env,
    ML_API_ORIGIN: 'https://ml.example',
    ML_API_KEY: 'server-only-key',
    ADMIN_API_TOKEN: 'admin-only-key',
  };
  const mlResponse = await worker.fetch(request('/api/ml/status'), mlEnv, context);
  expect(mlResponse.status).toBe(200);
  expect(await mlResponse.json()).toEqual({ model: { ready: false } });
  const gridResponse = await worker.fetch(request('/api/downscaled/LIVE-RAIN?hour=96'), mlEnv, context);
  expect(gridResponse.status).toBe(200);
  expect(mlRequests.at(-1)?.pathname).toBe('/v1/downscaled/LIVE-RAIN');
  expect(mlRequests.at(-1)?.searchParams.get('hour')).toBe('96');
  expect(mlRequests.at(-1)?.searchParams.has('lat')).toBe(true);
  expect(mlRequests.at(-1)?.searchParams.has('lon')).toBe(true);
  expect((await worker.fetch(request('/api/ml/track/LIVE-RAIN?hour=96'), mlEnv, context)).status).toBe(
    200,
  );
  expect(mlRequests.at(-1)?.pathname).toBe('/v1/track/LIVE-RAIN');
  expect((await worker.fetch(request('/api/downscaled/LIVE-RAIN?hour=63'), mlEnv, context)).status).toBe(
    400,
  );
  expect((await worker.fetch(request('/api/downscaled/%2e%2e'), mlEnv, context)).status).toBe(404);
});

test('TypeScript API reads private assets from Backblaze B2 with server-side signing', async () => {
  let b2Authorization = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      b2Authorization = new Headers(init?.headers).get('Authorization') || '';
      expect(url.href).toBe('https://s3.us-west-004.backblazeb2.com/weather-assets/geojson/sample.json');
      return new Response('{"type":"FeatureCollection","features":[]}', {
        headers: {
          'Content-Type': 'application/geo+json',
          ETag: 'b2-etag',
        },
      });
    }),
  );
  const context = { waitUntil: (_promise: Promise<unknown>) => undefined } as ExecutionContext;
  const request = new Request('http://localhost/api/assets/geojson/sample.json', {
    headers: { Origin: 'http://127.0.0.1:5173' },
  });
  const response = await worker.fetch(
    request,
    {
      MODE: 'live',
      ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
      B2_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
      B2_REGION: 'us-west-004',
      B2_BUCKET: 'weather-assets',
      B2_KEY_ID: 'test-key-id',
      B2_APPLICATION_KEY: 'test-application-key',
    },
    context,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('application/geo+json');
  expect(response.headers.get('ETag')).toBe('b2-etag');
  expect(b2Authorization).toMatch(
    /^AWS4-HMAC-SHA256 Credential=test-key-id\/\d{8}\/us-west-004\/s3\/aws4_request/,
  );
  expect(await response.text()).toContain('FeatureCollection');
});

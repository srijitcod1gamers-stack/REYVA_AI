import { afterEach, expect, test, vi } from 'vitest';
import type { ExecutionContext } from '@cloudflare/workers-types';
import worker from '../../cloudflare/src/worker';

afterEach(() => vi.unstubAllGlobals());

test('TypeScript API serves live forecast screening without invented probabilities', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
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
  expect((await worker.fetch(request('/api/downscaled/LIVE-RAIN'), env, context)).status).toBe(501);
});

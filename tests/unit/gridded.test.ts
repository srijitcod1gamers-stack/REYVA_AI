import { afterEach, expect, test, vi } from 'vitest';
import { GriddedWeather } from '../../cloudflare/src/gridded';
import { pointInFootprint } from '../../cloudflare/src/exposure';
import type { ForecastFrame } from '../../shared/types';

afterEach(() => vi.unstubAllGlobals());
test('native-grid tracks keep disconnected objects separate and preserve absence at a forecast step', async () => {
  const initialization = new Date().toISOString();
  const field = {
    latitudes: [6, 6.25],
    longitudes: [68, 68.25],
    values: [
      [30, 40],
      [50, 60],
    ],
  };
  const object = (x: number) => ({
    centroid: [x + 0.125, 6.125],
    area_km2: 700,
    cells: 4,
    peak: 60,
    geometries: [
      {
        type: 'Polygon',
        coordinates: [
          [
            [x, 6],
            [x + 0.25, 6],
            [x + 0.25, 6.25],
            [x, 6.25],
            [x, 6],
          ],
        ],
      },
    ],
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const key = new URL(String(input)).pathname;
      const body = key.endsWith('latest.json')
        ? {
            initialization,
            published_at: initialization,
            frames: [
              { hour: 72, key: 'raster/test/72.json' },
              { hour: 96, key: 'raster/test/96.json' },
            ],
          }
        : {
            hour: key.endsWith('72.json') ? 72 : 96,
            valid_time: initialization,
            initialization,
            source: 'NOAA test',
            ensemble_members: 5,
            resolution_degrees: 0.25,
            fields: { rainfall: field, wind: field, pressure: field },
            objects: {
              rainfall: key.endsWith('72.json') ? [object(68), object(70)] : [object(68.1)],
              wind: [],
            },
          };
      return new Response(JSON.stringify(body));
    }),
  );
  const provider = await new GriddedWeather({
    B2_ENDPOINT: 's3.example.backblazeb2.com',
    B2_REGION: 'test',
    B2_BUCKET: 'test',
    B2_KEY_ID: 'test',
    B2_APPLICATION_KEY: 'test',
  }).load();
  const events = provider.events();
  expect(events).toHaveLength(2);
  expect(events[0].trajectory).toHaveLength(2);
  expect(provider.frame(events[1].id, 96).polygons).toHaveLength(0);
  expect(provider.frame(events[1].id, 96).areaKm2).toBe(0);
  expect(provider.frame(events[0].id, 73).hour).toBe(72);
  expect(provider.risk([0, 0], events[0].id, 72, 'outside')).toBeNull();
});
test('facility intersection respects polygon holes and excludes outside representative points', () => {
  const polygons = [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
            [0, 0],
          ],
          [
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 2],
            [1, 1],
          ],
        ],
      },
      properties: {},
    },
  ] as ForecastFrame['polygons'];
  expect(pointInFootprint([3, 3], polygons)).toBe(true);
  expect(pointInFootprint([1.5, 1.5], polygons)).toBe(false);
  expect(pointInFootprint([5, 3], polygons)).toBe(false);
});

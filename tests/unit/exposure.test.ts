import { expect, test, vi } from 'vitest';
import type { ForecastFrame } from '../../shared/types';

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../cloudflare/src/gridded', () => ({ readPublished: read }));
import { assessExposure } from '../../cloudflare/src/exposure';

test('Exposure counts stored facility points inside the actual footprint, excluding holes', async () => {
  const retrieved = new Date().toISOString();
  read.mockImplementation(async (_env, key) =>
    key.endsWith('latest.json')
      ? {
          bounds: [67, 5, 99, 37],
          retrieved_at: retrieved,
          complete_query: true,
          tiles: { '10/75': { key: 'geojson/facilities/test/10/75.json' } },
        }
      : [
          { id: 'node/1', kind: 'hospital', name: 'Inside', coordinates: [76, 11] },
          { id: 'node/2', kind: 'school', name: 'In hole', coordinates: [77, 12] },
          { id: 'node/3', kind: 'clinic', name: 'Outside', coordinates: [79, 14] },
        ],
  );
  const frame = {
    polygons: [
      {
        geometry: {
          coordinates: [
            [
              [75, 10],
              [78, 10],
              [78, 13],
              [75, 13],
              [75, 10],
            ],
            [
              [76.5, 11.5],
              [77.5, 11.5],
              [77.5, 12.5],
              [76.5, 12.5],
              [76.5, 11.5],
            ],
          ],
        },
      },
    ],
  } as ForecastFrame;
  const result = await assessExposure(frame, {});
  expect(result.assets.map((a) => a.id)).toEqual(['node/1']);
  expect(result.counts).toEqual({ hospital: 1 });
  expect(result.population).toBeNull();
  expect(result.fetched_at).toBe(retrieved);
});

test('Incomplete facility snapshots are refused instead of publishing partial counts', async () => {
  read.mockResolvedValue({
    bounds: [67, 5, 99, 37],
    retrieved_at: new Date().toISOString(),
    complete_query: false,
    tiles: {},
  });
  const frame = {
    polygons: [
      {
        geometry: {
          coordinates: [
            [
              [80, 15],
              [81, 15],
              [81, 16],
              [80, 16],
              [80, 15],
            ],
          ],
        },
      },
    ],
  } as ForecastFrame;
  await expect(assessExposure(frame, {})).rejects.toThrow('incomplete');
});

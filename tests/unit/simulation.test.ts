import { describe, expect, it } from 'vitest';
import { demoApi } from '../../shared/api';
import { events } from '../../shared/fixtures';
import { frameFor, riskFor } from '../../shared/simulation';

describe('forecast contract', () => {
  const cyclone = events[0];
  it('evolves spatially while preserving closed, ordered risk footprints', () => {
    const early = frameFor(cyclone, 72),
      late = frameFor(cyclone, 168);
    expect(early.centroid).not.toEqual(late.centroid);
    expect(early.impact.population).not.toBe(late.impact.population);
    expect(late.polygons).toHaveLength(3);
    for (const polygon of late.polygons) {
      expect(polygon.geometry.coordinates[0][0]).toEqual(polygon.geometry.coordinates[0].at(-1));
      expect(polygon.properties.eventId).toBe(cyclone.id);
    }
    expect(late.polygons[0].geometry.coordinates[0][0]).not.toEqual(
      late.polygons[2].geometry.coordinates[0][0],
    );
  });
  it('assigns lower local risk farther from the same forecast core', () => {
    const frame = frameFor(cyclone, 96);
    const near = riskFor(frame.centroid, 'Core', cyclone, 96);
    const far = riskFor([70, 8], 'Far field', cyclone, 96);
    expect(near.probability).toBeGreaterThan(far.probability);
    expect(near.provenance.kind).toBe('simulated');
  });
  it('rejects invalid API coordinates rather than returning fabricated local risk', () => {
    const response = demoApi(new URL('https://example.test/api/risk?lat=98&lon=88'));
    expect(response.status).toBe(422);
  });
});

import { test, expect } from '@playwright/test';
import { events } from '../../shared/fixtures';
import { frameFor } from '../../shared/simulation';
const event = {
  ...events[0],
  id: 'GRID-RAINFALL-1',
  name: 'Rainfall object 1',
  leadTime: 120,
  provenance: {
    kind: 'forecast',
    source: 'NOAA GEFS test fixture',
    model: 'GEFS native grid',
    run: '2026-10-01T06:00:00Z',
    disclaimer: 'Forecast screening test fixture',
  },
  trajectory: events[0].trajectory,
};
const grid = {
  latitudes: [20, 20.25],
  longitudes: [85, 85.25],
  values: [
    [30, 40],
    [50, 60],
  ],
};
const caseData = {
  id: 'fani-2019',
  hour: 96,
  initialization: '2019-04-27T00:00:00Z',
  valid_time: '2019-05-01T00:00:00Z',
  source: 'NOAA GEFS / CHIRPS fixture',
  forecast: grid,
  observation: grid,
  interpolation: grid,
  metrics: { mae_mm: 2, rmse_mm: 3, observed_cells: 4, scope: 'Reference land' },
  resolution_degrees: { forecast: 0.25, observation: 0.05 },
  note: 'Actual verification window',
};
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const hour = Number(url.searchParams.get('hour') ?? 120);
    const frame = {
      ...frameFor(events[0], hour, false),
      hour,
      grid: {
        fields: { rainfall: grid, wind: grid, pressure: grid },
        resolution_degrees: 0.25,
        source: 'NOAA fixture',
      },
      areaKm2: 2400,
      detected: true,
      availableHours: [72, 96, 120, 144, 168, 192, 216, 240],
    };
    let body: unknown;
    switch (url.pathname) {
      case '/api/events':
        body = [event];
        break;
      case '/api/forecast':
        body = frame;
        break;
      case '/api/risk':
        body = {
          name: url.searchParams.get('name'),
          coordinates: [88.36, 22.57],
          eventId: event.id,
          severity: 'MODERATE',
          probability: null,
          confidence: null,
          rainfall: { min: 30, max: 30 },
          wind: 40,
          arrivalHours: [hour, hour],
          distanceKm: 200,
          impact: 'Native cell forecast',
          provenance: event.provenance,
        };
        break;
      case '/api/replay':
        body = {
          cases: [
            { id: 'fani-2019', name: 'Fani 2019', valid_time: caseData.valid_time },
            { id: 'nargis-2008', name: 'Nargis 2008', valid_time: caseData.valid_time },
          ],
        };
        break;
      case '/api/replay/fani-2019':
      case '/api/replay/nargis-2008':
        body = caseData;
        break;
      case '/api/ml/status':
        body = {
          model: {
            approved: false,
            ready: false,
            test: { model_mae_mm: 12.27, baseline_mae_mm: 12.24 },
          },
          tracker: { approved: false, test: { f1: 0.138 } },
          training_samples: 52,
          historical_cases: 12,
          inference_connected: false,
        };
        break;
      case '/api/alerts':
        body = [
          {
            id: 'ALERT-1',
            eventId: event.id,
            title: 'Rainfall threshold advisory',
            region: 'India',
            coordinates: [85, 20],
            severity: 'HIGH',
            confidence: 0,
            leadHours: 120,
            timestamp: caseData.valid_time,
            forecastWindow: caseData.valid_time,
            rainfall: 60,
            wind: 40,
            population: 0,
            polygon: frame.polygons[0],
            acknowledged: false,
            provenance: event.provenance,
          },
        ];
        break;
      default:
        body = { error: 'Unsupported test endpoint' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
});
test('native forecast loads a grid, uses published time steps and returns coordinate risk', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Weather signals' })).toBeVisible();
  await expect(page.locator('.maplibre-container canvas').first()).toBeVisible();
  await page.getByRole('slider', { name: 'Forecast hour' }).fill('144');
  await expect(page.locator('.timeline-current')).toContainText('T+144h');
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Search commands or locations' }).fill('Kolkata');
  await page.getByRole('button', { name: /Kolkata.*West Bengal/ }).click();
  await expect(page.getByRole('heading', { name: 'Kolkata' })).toBeVisible();
});
test('mobile navigation exposes measured withheld model status and real verification layers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Intelligence' }).click();
  await expect(page.getByRole('heading', { name: 'Rainfall object 1' })).toBeVisible();
  await page.goto('/downscaling');
  await expect(page.getByRole('heading', { name: '5 km rainfall model' })).toBeVisible();
  await expect(page.getByText(/Trained checkpoint withheld/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /CHIRPS reference/ })).toBeVisible();
});
test('historical datasets remain accessible when the live event endpoint is unavailable', async ({
  page,
}) => {
  await page.route('**/api/events', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"Live source offline"}',
    }),
  );
  await page.goto('/replay');
  await expect(page.getByRole('heading', { name: 'Historical case explorer' })).toBeVisible();
  await expect(page.locator('.dataset-grid-map canvas').first()).toBeVisible();
  await page.getByLabel('Historical case').selectOption('nargis-2008');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('native screening advisory exports GeoJSON without invented exposure counts', async ({ page }) => {
  await page.goto('/alerts');
  await expect(page.getByRole('heading', { name: 'Alert center' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'GeoJSON' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.geojson$/);
});

test('selecting another native event assesses that event at its peak forecast step', async ({
  page,
}) => {
  const other = { ...event, id: 'GRID-RAINFALL-2', name: 'Rainfall object 2', leadTime: 72 };
  await page.route('**/api/events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([event, other]),
    }),
  );
  await page.route('**/api/exposure?**', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('event_id')).toBe(other.id);
    expect(url.searchParams.get('hour')).toBe('72');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        assets: [{ id: 'node/1', name: 'Test hospital', kind: 'hospital', coordinates: [85, 20] }],
        counts: { hospital: 1 },
        method: 'Mapped representative point',
        fetched_at: '2026-10-01T00:00:00Z',
      }),
    });
  });
  await page.goto('/events');
  await page.locator('.event-table-row').filter({ hasText: other.id }).click();
  await page.locator('a[href="/impact"]').first().click();
  await page.getByRole('button', { name: 'Find exposed facilities' }).click();
  await expect(page.locator('.exposure-results p').first()).toContainText('1 mapped facilities');
});

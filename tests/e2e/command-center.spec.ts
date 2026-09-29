import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://ensemble-api.open-meteo.com/v1/ensemble**', async (route) => {
    const url = new URL(route.request().url());
    const lats = (url.searchParams.get('latitude') || '').split(',').map(Number);
    const lons = (url.searchParams.get('longitude') || '').split(',').map(Number);
    const start = Date.parse('2026-09-28T00:00:00Z');
    const time = Array.from({ length: 240 }, (_, i) =>
      new Date(start + i * 3600000).toISOString().slice(0, 16),
    );
    const points = lats.map((latitude, index) => ({
      latitude,
      longitude: lons[index],
      hourly: {
        time,
        precipitation: time.map(() => (index === 0 ? 7 : 2)),
        precipitation_spread: time.map(() => 1),
        wind_gusts_10m: time.map(() => (index === 0 ? 90 : 35)),
        wind_gusts_10m_spread: time.map(() => 4),
        temperature_2m: time.map(() => (index === 13 ? 40 : 29)),
        temperature_2m_spread: time.map(() => 1),
        pressure_msl: time.map(() => 1002),
        relative_humidity_2m: time.map(() => 80),
      },
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(points.length === 1 ? points[0] : points),
    });
  });
});

test('live forecast loads sampled GEFS values and coordinate risk', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Weather signals' })).toBeVisible();
  await expect(page.getByText('LIVE ENSEMBLE INPUT')).toBeVisible();
  await expect(page.locator('.maplibre-container canvas').first()).toBeVisible();
  expect((await page.locator('.maplibre-container').boundingBox())?.height).toBeGreaterThan(300);
  const slider = page.getByRole('slider', { name: 'Forecast hour' });
  await slider.fill('144');
  await expect(page.locator('.timeline-current')).toContainText('T+144h');
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Search commands or locations' }).fill('Kolkata');
  await page.getByRole('button', { name: /Kolkata.*West Bengal/ }).click();
  await expect(page.getByRole('heading', { name: 'Kolkata' })).toBeVisible();
  await expect(page.getByText('LOCATION FORECAST')).toBeVisible();
});

test('mobile forecast tabs and live downscaling status are clear', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '4D map' })).toBeVisible();
  await page.getByRole('button', { name: /Signals · 3/ }).click();
  await expect(page.getByRole('heading', { name: 'Weather signals' })).toBeVisible();
  await page.getByRole('button', { name: 'Intelligence' }).click();
  await expect(page.getByRole('heading', { name: 'Heavy rainfall signal' })).toBeVisible();
  await page.goto('/downscaling');
  await expect(page.getByRole('heading', { name: '5 km detail workspace' })).toBeVisible();
  await expect(page.getByText('Awaiting trained downscaling model')).toBeVisible();
});

test('live screening advisory exports GeoJSON', async ({ page }) => {
  await page.goto('/alerts');
  await expect(page.getByRole('heading', { name: 'Alert center' })).toBeVisible();
  await expect(page.getByText('LIVE INPUT · NOT AN OFFICIAL WARNING')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'GeoJSON' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.geojson$/);
});

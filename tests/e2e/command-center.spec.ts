import { test, expect } from '@playwright/test';

test('command center drives the forecast and location risk', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Active threats' })).toBeVisible();
  await expect(page.locator('.maplibre-container canvas').first()).toBeVisible();
  expect((await page.locator('.maplibre-container').boundingBox())?.height).toBeGreaterThan(300);
  const slider = page.getByRole('slider', { name: 'Forecast hour' });
  const box = await slider.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * (72 / 168), box!.y + box!.height / 2);
  const actual = Number(await slider.inputValue());
  await slider.focus();
  for (let i = 0; i < Math.abs(144 - actual); i++)
    await slider.press(actual < 144 ? 'ArrowRight' : 'ArrowLeft');
  await expect(page.locator('.timeline-current')).toContainText('T+144h');
  await page.getByRole('button', { name: /Extreme rainfall.*Western Ghats/ }).click();
  await expect(page.locator('.intelligence-eyebrow')).toContainText('WX-025');
  await page.keyboard.press('Control+k');
  await page.getByRole('textbox', { name: 'Search commands or locations' }).fill('Kolkata');
  await page.getByRole('button', { name: /Kolkata.*West Bengal/ }).click();
  await expect(page.getByRole('heading', { name: 'Kolkata' })).toBeVisible();
  await expect(page.locator('.location-probability')).toContainText('Modeled rainfall probability');
});

test('mobile map and intelligence tabs remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: '4D map' })).toBeVisible();
  expect((await page.locator('.maplibre-container').boundingBox())?.height).toBeGreaterThan(200);
  await page.getByRole('button', { name: /Active threats · 4/ }).click();
  await expect(page.getByRole('heading', { name: 'Active threats' })).toBeVisible();
  await page.getByRole('button', { name: 'Intelligence' }).click();
  await expect(page.getByRole('heading', { name: 'Cyclonic system' })).toBeVisible();
});

test('downscaling and alert exports are available without operational services', async ({ page }) => {
  await page.goto('/downscaling');
  await expect(page.getByRole('heading', { name: 'AI downscaling lab' })).toBeVisible();
  await expect(page.getByText('Validation comparison')).toBeVisible();
  await page.getByRole('button', { name: '5 km interpolation' }).click();
  await expect(page.getByRole('heading', { name: 'Interpolated field' })).toBeVisible();
  await page.goto('/alerts');
  await expect(page.getByRole('heading', { name: 'Alert center' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'GeoJSON' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.geojson$/);
});

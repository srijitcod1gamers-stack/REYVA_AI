import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await page.route(/^https:\/\//, (route) => route.abort());
    page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
    await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
    await page.locator('.event-feed h2').waitFor({ state: 'attached', timeout: 30000 });
    await page
      .locator('.maplibre-container canvas')
      .first()
      .waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('.map-loading').waitFor({ state: 'hidden', timeout: 30000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `artifacts/command-center-${name}.png`, animations: 'disabled' });
    console.log(`${name}: ${await page.title()} · screenshot saved`);
    await page.close();
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}

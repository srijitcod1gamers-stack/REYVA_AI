import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 12000 },
  use: {
    ...devices['Desktop Chrome'],
    channel: 'msedge',
    baseURL: 'http://127.0.0.1:5173',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: process.platform === 'win32' ? 'npm.cmd run preview' : 'npm run preview',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60000,
  },
});

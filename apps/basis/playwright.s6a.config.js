/**
 * Throwaway Playwright config for the S6.A inline-buttons e2e — runs on a FRESH
 * port (5216), never touching the user's dev server on :5173. Boots its own vite
 * with a dummy circle LLM base URL so the bot "engages" (the deterministic gate
 * never calls it). Run: npx playwright test --config playwright.s6a.config.js
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test-browser',
  testMatch: 'circle-inline-buttons.spec.js',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5216', trace: 'off', headless: true, ...devices['Desktop Chrome'] },
  webServer: {
    command: 'vite --port 5216 --strictPort',
    url: 'http://localhost:5216',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { VITE_CIRCLE_LLM_BASEURL: 'http://127.0.0.1:9999' },
  },
});

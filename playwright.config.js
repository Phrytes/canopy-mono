/**
 * Root-level Playwright config so `pnpm exec playwright test …` works
 * from the monorepo root.  Today basis is the only app with a
 * Playwright suite — this config inlines its settings.  As more apps
 * add Playwright tests, extend with multiple projects.
 *
 * Without this file the root invocation falls back to NO config:
 * baseURL undefined → `page.goto('/')` throws "Cannot navigate to
 * invalid URL".  See apps/basis/playwright.config.js for the
 * per-app version (useful when running from inside that app).
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/basis/test-browser',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm --filter basis dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

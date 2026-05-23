/**
 * Playwright config for canopy-chat browser-driven tests.
 *
 * Boots `pnpm dev` on a known port, then drives two browser
 * contexts so we can headlessly verify the things that Vitest
 * can't reach: real DOM rendering, IndexedDB persistence under
 * a Chromium runtime, multi-tab cross-peer flows (sender Tab A,
 * receiver Tab B).
 *
 * Note: this config + the example test (test-browser/) are scaffold
 * only.  To USE them you must first install Playwright from the
 * repo root:
 *
 *   cd /home/frits/expotest/canopy-mono
 *   pnpm add -Dw @playwright/test playwright
 *   pnpm exec playwright install chromium
 *
 * Then run from this app:
 *
 *   pnpm --filter canopy-chat exec playwright test
 *
 * The browser-driven tests live in `test-browser/` (separate from
 * `test/` so Vitest doesn't pick them up — Playwright + Vitest have
 * incompatible runners).
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test-browser',
  /* Run tests in parallel where safe; the dev server is shared. */
  fullyParallel: false,
  /* Fail the build on accidental `test.only` left in source */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /* Single worker keeps two-tab orchestration deterministic. */
  workers: 1,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    /* Headless by default — flip to false locally with
     * `pnpm exec playwright test --headed` to watch the flows. */
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  /* Boot the dev server automatically.  The reuseExistingServer flag
   * lets a manually-started `pnpm dev` survive across test runs. */
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

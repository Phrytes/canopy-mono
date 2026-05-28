/**
 * Playwright config — canopy-chat-mobile cross-device parity tests
 * (#224 Phase A).
 *
 * The mobile shell, served as an Expo Web bundle, is driven through
 * the same canonical pipeline as the canopy-chat web app.  These
 * tests assert the portable-core (parseInput / resolveDispatch /
 * runDispatch / renderReply) behaves identically across the two
 * surfaces — guarding against subtle RN-only branches leaking into
 * the shared modules.
 *
 * Prereq (one-time, also re-run when source changes):
 *   pnpm --filter canopy-chat-mobile build:web
 *
 * Then:
 *   cd apps/canopy-chat-mobile
 *   npx playwright test
 *
 * No real WebID / pod creds needed — the test serves the static
 * Expo Web export and exercises chat-shell mechanics.  Real-peer
 * cross-device flows are #224 Phase B (Detox).
 *
 * Browser-driven tests live in `test-browser/` (separate from
 * `test/` so vitest doesn't pick them up; Playwright + vitest have
 * incompatible runners).
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORT || 4173;

export default defineConfig({
  testDir: './test-browser',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace:    'on-first-retry',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Static-serve the pre-built Expo Web export.  Using python3's
    // built-in http.server keeps this CI-friendly without an extra
    // Node dep — the bundle is hashed/cached so no rebuild-per-test.
    command: `python3 -m http.server ${PORT} --directory dist-web`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

/**
 * canopy-chat — vitest config.  Per-test-file environment selection:
 * DOM-adapter + smoke tests use happy-dom; pure-logic suites stay in
 * the default node environment (faster).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Per-file env via @vitest/environment directive at the top of
    // each test file that needs DOM (see test/domAdapter.test.js).
    environment: 'node',
    // Vitest's default include picks up `**/*.spec.{js,...}` which
    // collides with Playwright (test-browser/*.spec.js).  Restrict
    // to the canonical `test/**` location so Playwright owns
    // `test-browser/**` cleanly.
    include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['test-browser/**', 'node_modules/**'],
  },
});

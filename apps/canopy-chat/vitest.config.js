/**
 * canopy-chat — vitest config.  Per-test-file environment selection:
 * DOM-adapter + smoke tests use happy-dom; pure-logic suites stay in
 * the default node environment (faster).
 */
import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // The web-smoke boot transitively reaches the RN-only async-storage leaf
      // (pod-client dynamic-imports it); vite can't resolve the RN package in
      // node. Alias it to an in-memory stub so the smoke test loads.
      '@react-native-async-storage/async-storage': path.resolve(__dirname, 'test/stubs/asyncStorage.js'),
      // @canopy/core's barrel eagerly re-exports MqttTransport (an optional runtime transport) whose
      // `import('mqtt')` vite can't pre-resolve when mqtt isn't installed → any suite reaching the barrel
      // (web-smoke, circleFolio.dom, …) fails to LOAD. Stub it; no test uses a live MQTT connection.
      mqtt: path.resolve(__dirname, 'test/stubs/mqtt.js'),
    },
  },
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

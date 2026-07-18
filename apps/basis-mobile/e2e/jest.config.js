// Jest config for Detox E2E tests (D-0 setup, 2026-05-26).
// Lives parallel to but distinct from vitest — Detox can't run on
// vitest, so the parent app keeps `pnpm exec vitest run` for unit
// tests and uses `npm run detox:test` for the device-level layer.
//
// The `globalSetup`/`globalTeardown` paths are provided by Detox
// itself (Detox 20+ ships them — no need to wire up custom ones).

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir:        '..',
  testMatch:      ['<rootDir>/e2e/**/*.test.js'],
  testTimeout:    180000,          // first boot can take 30s+
  maxWorkers:     1,
  globalSetup:    'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters:      ['detox/runners/jest/reporter'],
  testEnvironment:'detox/runners/jest/testEnvironment',
  verbose:        true,
};

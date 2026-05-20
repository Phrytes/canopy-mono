import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    // Demo uses real tasks-v0 multi-crew runtime (mesh agent + transports).
    // Allow a generous timeout for the setup-heavy turns.
    testTimeout: 20_000,
  },
});

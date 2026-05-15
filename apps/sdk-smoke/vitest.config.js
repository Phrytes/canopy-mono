import { defineConfig } from 'vitest/config';

// sdk-smoke is a manual two-device Expo harness — one button per
// scenario, no automated unit tests. Don't fail the run (or a repo-wide
// sweep that calls `vitest run` directly) just because there are no
// test files.
export default defineConfig({
  test: {
    passWithNoTests: true,
  },
});

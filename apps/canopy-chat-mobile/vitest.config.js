/**
 * Vitest config — runs the PORTABLE core tests only.  RN screens
 * + the Expo entry are NOT tested here (Vitest can't render RN
 * components; that's #224A Playwright/Expo-web's job).
 *
 * Excludes the RN files explicitly so a future stray `import 'react-
 * native'` from the core layer fails loud instead of being skipped.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    exclude: ['**/node_modules/**', 'src/rn/**', 'src/screens/**'],
    environment: 'node',
  },
});

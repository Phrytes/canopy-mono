/**
 * canopy-chat — Vite config for the v0.1.4 static web demo.
 *
 * Build pipeline (sub-slice 1.12): outputs to `dist/` for deploy to
 * any static host (or the user's pod once that flow exists in v0.6).
 *
 * Dev server: `pnpm --filter @canopy-app/canopy-chat dev` boots Vite
 * on port 5173 with hot reload.
 */

import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  // Allow imports from outside `web/` (the src/ + locales/ trees).
  server: { fs: { allow: ['..'] } },
  build:  {
    outDir:    '../dist',
    emptyOutDir: true,
    target:    'es2022',
    rollupOptions: {
      // Single entry; everything else lazy-loaded ESM.
      input: 'web/index.html',
    },
  },
});

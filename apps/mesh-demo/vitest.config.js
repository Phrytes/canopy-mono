import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '../..');

export default defineConfig({
  resolve: {
    alias: {
      // Point imports at the local package source so tests run without npm install
      '@canopy/core':         path.resolve(repoRoot, 'packages/core/src/index.js'),
      '@canopy/react-native': path.resolve(repoRoot, 'packages/react-native/index.js'),
    },
  },
  test: {
    environment: 'node',
    globals:     true,
  },
});

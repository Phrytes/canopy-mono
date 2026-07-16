import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '../..');

export default defineConfig({
  resolve: {
    alias: {
      // Point imports at the local sources so tests run without npm install.
      // Folio is consumed for the SyncEngine subclass only — the
      // RN serviceFactory + backgroundTasks moved to
      // @onderling/sync-engine-rn 2026-05-08 (Phase 40.2 follow-up).
      '@onderling-app/folio':                   path.resolve(repoRoot, 'apps/folio/src/index.js'),
      '@onderling/core':                        path.resolve(repoRoot, 'packages/core/src/index.js'),
      '@onderling/pod-client':                  path.resolve(repoRoot, 'packages/pod-client/src/index.js'),
      '@onderling/react-native':                path.resolve(repoRoot, 'packages/react-native/index.js'),
      '@onderling/sync-engine-rn':              path.resolve(repoRoot, 'packages/sync-engine-rn/index.js'),
      '@onderling/oidc-session-rn/hook':        path.resolve(repoRoot, 'packages/oidc-session-rn/hook.js'),
      '@onderling/oidc-session-rn':             path.resolve(repoRoot, 'packages/oidc-session-rn/index.js'),
      // @scure/bip39 ESM exports not auto-resolved by Vitest's Node
      // resolver — same fix applied in mesh-demo's metro.config.js.
      '@scure/bip39/wordlists/english': path.resolve(__dirname, 'node_modules/@scure/bip39/wordlists/english.js'),
      // @inrupt/solid-client* are Node-only deps that the SDK core
      // imports for its desktop SolidPodSource.  RN runtime is shielded
      // by metro.config.js; under vitest we stub them so the tests
      // don't need the heavyweight Inrupt install path.
      '@inrupt/solid-client':              path.resolve(__dirname, 'test/stubs/inrupt.js'),
      '@inrupt/solid-client-authn-node':   path.resolve(__dirname, 'test/stubs/inrupt.js'),
      // chokidar is a Node-only dep used by Folio's watcherNode adapter.
      // RN runtime never reaches it (we use watcherRN); under vitest we
      // stub it so tests that lazily import the engine factory don't
      // need the full Node fs ecosystem.
      'chokidar':                          path.resolve(__dirname, 'test/stubs/chokidar.js'),
    },
  },
  test: {
    environment: 'node',
    globals:     true,
    setupFiles:  [path.resolve(__dirname, 'test/setup.js')],
  },
});

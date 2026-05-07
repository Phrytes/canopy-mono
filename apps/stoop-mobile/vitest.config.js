import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '../..');

export default defineConfig({
  resolve: {
    alias: {
      // Point imports at the local sources so tests run without npm install.
      // Stoop-mobile imports the Stoop app barrel for the skill-builder
      // factory + Agent.js + groupMirror — same platform-shell pattern as
      // folio + folio-mobile, documented in
      // Project Files/conventions/architectural-layering.md.
      '@canopy-app/stoop':                   path.resolve(repoRoot, 'apps/stoop/src/index.js'),

      // SDK packages — point at sources, not node_modules.
      '@canopy/core':                        path.resolve(repoRoot, 'packages/core/src/index.js'),
      '@canopy/pod-client':                  path.resolve(repoRoot, 'packages/pod-client/src/index.js'),
      '@canopy/react-native':                path.resolve(repoRoot, 'packages/react-native/index.js'),
      '@canopy/sync-engine-rn':              path.resolve(repoRoot, 'packages/sync-engine-rn/index.js'),
      '@canopy/oidc-session-rn/hook':        path.resolve(repoRoot, 'packages/oidc-session-rn/hook.js'),
      '@canopy/oidc-session-rn':             path.resolve(repoRoot, 'packages/oidc-session-rn/index.js'),
      '@canopy/local-store':                 path.resolve(repoRoot, 'packages/local-store/index.js'),
      '@canopy/identity-resolver':           path.resolve(repoRoot, 'packages/identity-resolver/src/index.js'),
      '@canopy/item-store':                  path.resolve(repoRoot, 'packages/item-store/src/index.js'),
      '@canopy/notifier':                    path.resolve(repoRoot, 'packages/notifier/src/index.js'),
      '@canopy/skill-match':                 path.resolve(repoRoot, 'packages/skill-match/src/index.js'),
      '@canopy/chat-p2p':                    path.resolve(repoRoot, 'packages/chat-p2p/index.js'),

      // @scure/bip39 ESM exports not auto-resolved by Vitest's Node
      // resolver — same fix applied in folio-mobile.
      '@scure/bip39/wordlists/english': path.resolve(__dirname, 'node_modules/@scure/bip39/wordlists/english.js'),
      // @inrupt/solid-client* are Node-only deps that the SDK core
      // imports for its desktop SolidPodSource.  Stub for vitest.
      '@inrupt/solid-client':              path.resolve(__dirname, 'test/stubs/inrupt.js'),
      '@inrupt/solid-client-authn-node':   path.resolve(__dirname, 'test/stubs/inrupt.js'),
      // chokidar is a Node-only dep used by Folio's watcherNode adapter
      // (lifted into @canopy/sync-engine).  RN runtime never reaches
      // it; under vitest we stub.
      'chokidar':                          path.resolve(__dirname, 'test/stubs/chokidar.js'),
    },
  },
  test: {
    environment: 'node',
    globals:     true,
    setupFiles:  [path.resolve(__dirname, 'test/setup.js')],
  },
});

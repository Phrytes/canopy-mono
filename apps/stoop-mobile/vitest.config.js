import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '../..');

export default defineConfig({
  resolve: {
    alias: {
      // RN-harness (Option 2): force `react` (+ its JSX runtimes) to THIS app's
      // known-good local copy. packages/react-native components reached via the
      // `@onderling/react-native/*` barrels import react; with no react at the repo
      // root, vite mis-resolves it and dies on `./cjs/react.development.js`.
      // react-native itself is stubbed in test/setup.js, so the component loads
      // inert and the pure helpers beside it become importable. Longer keys first.
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
      'react/jsx-runtime':     path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react':                 path.resolve(__dirname, 'node_modules/react'),

      // Point imports at the local sources so tests run without npm install.
      // Stoop-mobile imports the Stoop app barrel for the skill-builder
      // factory + Agent.js + groupMirror — same platform-shell pattern as
      // folio + folio-mobile, documented in
      // Project Files/conventions/architectural-layering.md.
      '@onderling-app/stoop/lib/geo':           path.resolve(repoRoot, 'apps/stoop/src/lib/geo.js'),
      '@onderling-app/stoop/locales/en':        path.resolve(repoRoot, 'apps/stoop/locales/en.json'),
      '@onderling-app/stoop/locales/nl':        path.resolve(repoRoot, 'apps/stoop/locales/nl.json'),
      '@onderling-app/stoop':                   path.resolve(repoRoot, 'apps/stoop/src/index.js'),

      // SDK packages — point at sources, not node_modules.
      '@onderling/core':                        path.resolve(repoRoot, 'packages/core/src/index.js'),
      '@onderling/pod-client':                  path.resolve(repoRoot, 'packages/pod-client/src/index.js'),
      // Deep-path aliases (must come BEFORE the package-root mapping
      // so vite picks the longer prefix).  We deep-import the push
      // bridge bits in `src/lib/push.js` to avoid pulling the barrel
      // (which transitively imports `react-native-keychain` — a TS file).
      '@onderling/react-native/src':            path.resolve(repoRoot, 'packages/react-native/src'),
      '@onderling/react-native/identity/bootstrap': path.resolve(repoRoot, 'packages/react-native/src/identity/bootstrapIdentity.js'),
      '@onderling/react-native/identity':       path.resolve(repoRoot, 'packages/react-native/src/identity/index.js'),
      '@onderling/react-native/storage':        path.resolve(repoRoot, 'packages/react-native/src/storage/index.js'),
      '@onderling/react-native/deepLinks':      path.resolve(repoRoot, 'packages/react-native/src/deepLinks/index.js'),
      '@onderling/react-native/theme':          path.resolve(repoRoot, 'packages/react-native/src/theme/index.js'),
      '@onderling/react-native/components':     path.resolve(repoRoot, 'packages/react-native/src/components/index.js'),
      '@onderling/react-native/picker':         path.resolve(repoRoot, 'packages/react-native/src/picker/index.js'),
      '@onderling/react-native/qr/view':        path.resolve(repoRoot, 'packages/react-native/src/qr/QrCodeView.jsx'),
      '@onderling/react-native/qr':             path.resolve(repoRoot, 'packages/react-native/src/qr/index.js'),
      '@onderling/react-native/mnemonic/view':  path.resolve(repoRoot, 'packages/react-native/src/mnemonic/MnemonicView.jsx'),
      '@onderling/react-native/mnemonic':       path.resolve(repoRoot, 'packages/react-native/src/mnemonic/index.js'),
      '@onderling/react-native/push':           path.resolve(repoRoot, 'packages/react-native/src/push/index.js'),
      '@onderling/react-native/localisation':           path.resolve(repoRoot, 'packages/react-native/src/localisation/index.js'),
      '@onderling/react-native':                path.resolve(repoRoot, 'packages/react-native/index.js'),
      '@onderling/sync-engine-rn/react':        path.resolve(repoRoot, 'packages/sync-engine-rn/src/react/index.js'),
      '@onderling/sync-engine-rn':              path.resolve(repoRoot, 'packages/sync-engine-rn/index.js'),
      '@onderling/online-cadence':              path.resolve(repoRoot, 'packages/online-cadence/index.js'),
      '@onderling/oidc-session-rn/hook':        path.resolve(repoRoot, 'packages/oidc-session-rn/hook.js'),
      '@onderling/oidc-session-rn':             path.resolve(repoRoot, 'packages/oidc-session-rn/index.js'),
      '@onderling/local-store':                 path.resolve(repoRoot, 'packages/local-store/index.js'),
      '@onderling/identity-resolver/display':   path.resolve(repoRoot, 'packages/identity-resolver/src/display.js'),
      '@onderling/identity-resolver/skills':    path.resolve(repoRoot, 'packages/identity-resolver/src/skills.js'),
      '@onderling/identity-resolver':           path.resolve(repoRoot, 'packages/identity-resolver/src/index.js'),
      '@onderling/item-store':                  path.resolve(repoRoot, 'packages/item-store/src/index.js'),
      '@onderling/notifier':                    path.resolve(repoRoot, 'packages/notifier/src/index.js'),
      '@onderling/skill-match':                 path.resolve(repoRoot, 'packages/skill-match/src/index.js'),
      '@onderling/chat-p2p':                    path.resolve(repoRoot, 'packages/chat-p2p/index.js'),

      // @scure/bip39 ESM exports not auto-resolved by Vitest's Node
      // resolver — same fix applied in folio-mobile.
      '@scure/bip39/wordlists/english': path.resolve(__dirname, 'node_modules/@scure/bip39/wordlists/english.js'),
      // @inrupt/solid-client* are Node-only deps that the SDK core
      // imports for its desktop SolidPodSource.  Stub for vitest.
      '@inrupt/solid-client':              path.resolve(__dirname, 'test/stubs/inrupt.js'),
      '@inrupt/solid-client-authn-node':   path.resolve(__dirname, 'test/stubs/inrupt.js'),
      // chokidar is a Node-only dep used by Folio's watcherNode adapter
      // (lifted into @onderling/sync-engine).  RN runtime never reaches
      // it; under vitest we stub.
      'chokidar':                          path.resolve(__dirname, 'test/stubs/chokidar.js'),
    },
  },
  // JSX-in-.jsx loader — substrate components/* + qr/view + mnemonic/view
  // all use .jsx; Stoop's components/* are .js shims that re-export the
  // substrate JSX through the alias above (so loading them transitively
  // pulls in the .jsx files which need this loader).
  esbuild: {
    loader: 'jsx',
    include: [
      /apps\/stoop-mobile\/src\/components\/.*\.jsx?$/,
      /packages\/react-native\/src\/(qr|mnemonic|components)\/.*\.jsx?$/,
    ],
  },
  test: {
    environment: 'node',
    globals:     true,
    setupFiles:  [path.resolve(__dirname, 'test/setup.js')],
  },
});

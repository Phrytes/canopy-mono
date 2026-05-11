import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot  = path.resolve(__dirname, '../..');

export default defineConfig({
  // Treat .js files in this app's source as JSX-bearing — App.js +
  // future src/screens/*.js + src/components/*.js all use JSX. This
  // is the same trade-off stoop-mobile makes; we just declare it
  // explicitly for vitest's esbuild loader.
  esbuild: {
    loader: 'jsx',
    include: [
      /apps\/tasks-mobile\/.*\.jsx?$/,
      /packages\/react-native\/src\/(qr|mnemonic|components)\/.*\.jsx?$/,
    ],
    exclude: [],
  },
  resolve: {
    alias: {
      // Tasks app barrel — imported for the V2.8 single-agent factories
      // + role policy. Same platform-shell pattern as folio-mobile +
      // stoop-mobile (locked 2026-05-08, see
      // Project Files/conventions/architectural-layering.md).
      '@canopy-app/tasks-v0/MeshAgent':       path.resolve(repoRoot, 'apps/tasks-v0/src/MeshAgent.js'),
      '@canopy-app/tasks-v0/wireSkills':      path.resolve(repoRoot, 'apps/tasks-v0/src/wireSkills.js'),
      '@canopy-app/tasks-v0/bundleResolver':  path.resolve(repoRoot, 'apps/tasks-v0/src/bundleResolver.js'),
      '@canopy-app/tasks-v0/Crew':            path.resolve(repoRoot, 'apps/tasks-v0/src/Crew.js'),
      '@canopy-app/tasks-v0/locales/en':            path.resolve(repoRoot, 'apps/tasks-v0/locales/en.json'),
      '@canopy-app/tasks-v0/locales/nl':            path.resolve(repoRoot, 'apps/tasks-v0/locales/nl.json'),
      '@canopy-app/tasks-v0/locales/shared/en':     path.resolve(repoRoot, 'apps/tasks-v0/locales/shared/en.json'),
      '@canopy-app/tasks-v0/locales/shared/nl':     path.resolve(repoRoot, 'apps/tasks-v0/locales/shared/nl.json'),
      // Shared UI helpers (lifted 2026-05-10 per
      // Project Files/conventions/architectural-layering.md §
      // "Shared UI-glue helpers between platform shells"). Mirrors
      // the metro.config.js subpath resolver. Vite's prefix matcher
      // is greedy-longest so `/ui/<sub>` resolves before `/ui` alone.
      '@canopy-app/tasks-v0/ui':              path.resolve(repoRoot, 'apps/tasks-v0/src/ui'),
      '@canopy-app/tasks-v0':                 path.resolve(repoRoot, 'apps/tasks-v0/src/index.js'),

      // SDK packages — point at sources, not node_modules.
      '@canopy/core':                         path.resolve(repoRoot, 'packages/core/src/index.js'),
      '@canopy/pod-client':                   path.resolve(repoRoot, 'packages/pod-client/src/index.js'),

      // Deep-path aliases must come BEFORE the package-root mapping so
      // vite picks the longer prefix (BRING-UP-NOTES Trap 2).
      '@canopy/react-native/src':             path.resolve(repoRoot, 'packages/react-native/src'),
      '@canopy/react-native/identity/bootstrap': path.resolve(repoRoot, 'packages/react-native/src/identity/bootstrapIdentity.js'),
      '@canopy/react-native/identity':        path.resolve(repoRoot, 'packages/react-native/src/identity/index.js'),
      '@canopy/react-native/storage':         path.resolve(repoRoot, 'packages/react-native/src/storage/index.js'),
      '@canopy/react-native/deepLinks':       path.resolve(repoRoot, 'packages/react-native/src/deepLinks/index.js'),
      '@canopy/react-native/theme':           path.resolve(repoRoot, 'packages/react-native/src/theme/index.js'),
      '@canopy/react-native/components':      path.resolve(repoRoot, 'packages/react-native/src/components/index.js'),
      '@canopy/react-native/picker':          path.resolve(repoRoot, 'packages/react-native/src/picker/index.js'),
      '@canopy/react-native/qr/view':         path.resolve(repoRoot, 'packages/react-native/src/qr/QrCodeView.jsx'),
      '@canopy/react-native/qr':              path.resolve(repoRoot, 'packages/react-native/src/qr/index.js'),
      '@canopy/react-native/mnemonic/view':   path.resolve(repoRoot, 'packages/react-native/src/mnemonic/MnemonicView.jsx'),
      '@canopy/react-native/mnemonic':        path.resolve(repoRoot, 'packages/react-native/src/mnemonic/index.js'),
      '@canopy/react-native/push':            path.resolve(repoRoot, 'packages/react-native/src/push/index.js'),
      '@canopy/react-native/i18n':            path.resolve(repoRoot, 'packages/react-native/src/i18n/index.js'),
      '@canopy/react-native':                 path.resolve(repoRoot, 'packages/react-native/index.js'),

      '@canopy/sync-engine-rn/react':         path.resolve(repoRoot, 'packages/sync-engine-rn/src/react/index.js'),
      '@canopy/sync-engine-rn':               path.resolve(repoRoot, 'packages/sync-engine-rn/index.js'),
      '@canopy/online-cadence':               path.resolve(repoRoot, 'packages/online-cadence/index.js'),
      '@canopy/oidc-session-rn/hook':         path.resolve(repoRoot, 'packages/oidc-session-rn/hook.js'),
      '@canopy/oidc-session-rn':              path.resolve(repoRoot, 'packages/oidc-session-rn/index.js'),
      '@canopy/local-store':                  path.resolve(repoRoot, 'packages/local-store/index.js'),
      '@canopy/identity-resolver/display':    path.resolve(repoRoot, 'packages/identity-resolver/src/display.js'),
      '@canopy/identity-resolver/skills':     path.resolve(repoRoot, 'packages/identity-resolver/src/skills.js'),
      '@canopy/identity-resolver':            path.resolve(repoRoot, 'packages/identity-resolver/src/index.js'),
      '@canopy/item-store':                   path.resolve(repoRoot, 'packages/item-store/src/index.js'),
      '@canopy/notifier':                     path.resolve(repoRoot, 'packages/notifier/src/index.js'),
      '@canopy/skill-match':                  path.resolve(repoRoot, 'packages/skill-match/src/index.js'),
      '@canopy/chat-p2p':                     path.resolve(repoRoot, 'packages/chat-p2p/index.js'),

      // ESM resolution + Node-only deps — same fixes as stoop-mobile.
      '@scure/bip39/wordlists/english': path.resolve(__dirname, 'node_modules/@scure/bip39/wordlists/english.js'),
      '@inrupt/solid-client':              path.resolve(__dirname, 'test/stubs/inrupt.js'),
      '@inrupt/solid-client-authn-node':   path.resolve(__dirname, 'test/stubs/inrupt.js'),
      'chokidar':                          path.resolve(__dirname, 'test/stubs/chokidar.js'),
      // react-native-keychain ships TypeScript; vite's pre-resolve
      // hits it via the substrate's dynamic KeychainVault import even
      // when the runtime test path never reaches there. Stub with
      // parseable JS so the import-graph analysis succeeds.
      'react-native-keychain':             path.resolve(__dirname, 'test/stubs/keychain.js'),
      // expo-camera + react-native-qrcode-svg ship TypeScript; same
      // pre-resolve trap as react-native-keychain.
      'expo-camera':                       path.resolve(__dirname, 'test/stubs/expo-camera.js'),
      'react-native-qrcode-svg':           path.resolve(__dirname, 'test/stubs/qrcode-svg.js'),
    },
  },
  test: {
    environment: 'node',
    globals:     true,
    setupFiles:  [path.resolve(__dirname, 'test/setup.js')],
  },
});

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
      // RN-harness (Option 2): force `react` (+ jsx runtimes) to THIS app's
      // known-good local copy. Screen/component modules + @onderling/react-native
      // barrels import react; with no react at the repo root, vite mis-resolves
      // it and dies on `./cjs/react.development.js`. Longer keys first.
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
      'react/jsx-runtime':     path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react':                 path.resolve(__dirname, 'node_modules/react'),

      // Tasks app barrel — imported for the single-agent factories
      // + role policy. Same platform-shell pattern as folio-mobile +
      // stoop-mobile (locked 2026-05-08, see
      // Project Files/conventions/architectural-layering.md).
      // M1-S3: substrate helpers shared via device-independent paths
      // (platform parity — NOT mobile forks). Deep paths before barrel.
      '@onderling-app/tasks/lib/substrateStack':  path.resolve(repoRoot, 'apps/tasks-v0/src/lib/substrateStack.js'),
      '@onderling-app/tasks/substrateMirror':     path.resolve(repoRoot, 'apps/tasks-v0/src/substrateMirror.js'),
      // M2-S8: multi-circle onboarding-skill dispatch (issueInvite /
      // redeemInvite, registered once). Shared, not forked.
      '@onderling-app/tasks/multiCircleOnboarding': path.resolve(repoRoot, 'apps/tasks-v0/src/skills/multiCircleOnboarding.js'),
      '@onderling-app/tasks/lib':                 path.resolve(repoRoot, 'apps/tasks-v0/src/lib'),
      '@onderling-app/tasks/MeshAgent':       path.resolve(repoRoot, 'apps/tasks-v0/src/MeshAgent.js'),
      '@onderling-app/tasks/wireSkills':      path.resolve(repoRoot, 'apps/tasks-v0/src/wireSkills.js'),
      '@onderling-app/tasks/bundleResolver':  path.resolve(repoRoot, 'apps/tasks-v0/src/bundleResolver.js'),
      '@onderling-app/tasks/Circle':            path.resolve(repoRoot, 'apps/tasks-v0/src/Circle.js'),
      '@onderling-app/tasks/locales/en':            path.resolve(repoRoot, 'apps/tasks-v0/locales/en.json'),
      '@onderling-app/tasks/locales/nl':            path.resolve(repoRoot, 'apps/tasks-v0/locales/nl.json'),
      '@onderling-app/tasks/locales/shared/en':     path.resolve(repoRoot, 'apps/tasks-v0/locales/shared/en.json'),
      '@onderling-app/tasks/locales/shared/nl':     path.resolve(repoRoot, 'apps/tasks-v0/locales/shared/nl.json'),
      // Shared UI helpers (lifted 2026-05-10 per
      // Project Files/conventions/architectural-layering.md §
      // "Shared UI-glue helpers between platform shells"). Mirrors
      // the metro.config.js subpath resolver. Vite's prefix matcher
      // is greedy-longest so `/ui/<sub>` resolves before `/ui` alone.
      '@onderling-app/tasks/ui':              path.resolve(repoRoot, 'apps/tasks-v0/src/ui'),
      // the tasks-v0 root-level manifest.js is
      // not declared in tasks-v0's `package.json#exports`, but the
      // tasks-mobile NavModel adapter needs it.  Add a vitest alias
      // (Metro auto-resolves via `enablePackageExports: false`); when
      // tasks-v0 starts exporting `./manifest` officially this alias
      // becomes redundant.
      '@onderling-app/tasks/manifest':        path.resolve(repoRoot, 'apps/tasks-v0/manifest.js'),
      '@onderling-app/tasks':                 path.resolve(repoRoot, 'apps/tasks-v0/src/index.js'),

      // manifest projectors + web-adapter
      // helpers, consumed by `src/manifest-adapter.js` (NavModel
      // adapter for RN screens).  Metro auto-discovers from
      // packages/*/package.json; vitest needs explicit aliases.
      '@onderling/app-manifest':                 path.resolve(repoRoot, 'packages/app-manifest/src/index.js'),
      '@onderling/web-adapter':                  path.resolve(repoRoot, 'packages/web-adapter/src/index.js'),

      // SDK packages — point at sources, not node_modules.
      '@onderling/core':                         path.resolve(repoRoot, 'packages/core/src/index.js'),
      '@onderling/pod-client':                   path.resolve(repoRoot, 'packages/pod-client/src/index.js'),

      // Deep-path aliases must come BEFORE the package-root mapping so
      // vite picks the longer prefix (BRING-UP-NOTES Trap 2).
      '@onderling/react-native/src':             path.resolve(repoRoot, 'packages/react-native/src'),
      '@onderling/react-native/identity/bootstrap': path.resolve(repoRoot, 'packages/react-native/src/identity/bootstrapIdentity.js'),
      '@onderling/react-native/identity':        path.resolve(repoRoot, 'packages/react-native/src/identity/index.js'),
      '@onderling/react-native/storage':         path.resolve(repoRoot, 'packages/react-native/src/storage/index.js'),
      '@onderling/react-native/deepLinks':       path.resolve(repoRoot, 'packages/react-native/src/deepLinks/index.js'),
      '@onderling/react-native/theme':           path.resolve(repoRoot, 'packages/react-native/src/theme/index.js'),
      '@onderling/react-native/components':      path.resolve(repoRoot, 'packages/react-native/src/components/index.js'),
      '@onderling/react-native/picker':          path.resolve(repoRoot, 'packages/react-native/src/picker/index.js'),
      '@onderling/react-native/qr/view':         path.resolve(repoRoot, 'packages/react-native/src/qr/QrCodeView.jsx'),
      '@onderling/react-native/qr':              path.resolve(repoRoot, 'packages/react-native/src/qr/index.js'),
      '@onderling/react-native/mnemonic/view':   path.resolve(repoRoot, 'packages/react-native/src/mnemonic/MnemonicView.jsx'),
      '@onderling/react-native/mnemonic':        path.resolve(repoRoot, 'packages/react-native/src/mnemonic/index.js'),
      '@onderling/react-native/push':            path.resolve(repoRoot, 'packages/react-native/src/push/index.js'),
      '@onderling/react-native/ports':           path.resolve(repoRoot, 'packages/react-native/src/ports/index.js'),
      '@onderling/react-native/localisation':            path.resolve(repoRoot, 'packages/react-native/src/localisation/index.js'),
      '@onderling/react-native':                 path.resolve(repoRoot, 'packages/react-native/index.js'),

      '@onderling/sync-engine-rn/react':         path.resolve(repoRoot, 'packages/sync-engine-rn/src/react/index.js'),
      '@onderling/sync-engine-rn':               path.resolve(repoRoot, 'packages/sync-engine-rn/index.js'),
      '@onderling/agent-registry':               path.resolve(repoRoot, 'packages/agent-registry/index.js'),
      '@onderling/pseudo-pod':                   path.resolve(repoRoot, 'packages/pseudo-pod/index.js'),
      '@onderling/pod-routing':                  path.resolve(repoRoot, 'packages/pod-routing/index.js'),
      '@onderling/notify-envelope':              path.resolve(repoRoot, 'packages/notify-envelope/index.js'),
      '@onderling/online-cadence':               path.resolve(repoRoot, 'packages/online-cadence/index.js'),
      '@onderling/oidc-session-rn/hook':         path.resolve(repoRoot, 'packages/oidc-session-rn/hook.js'),
      '@onderling/oidc-session-rn':              path.resolve(repoRoot, 'packages/oidc-session-rn/index.js'),
      '@onderling/local-store':                  path.resolve(repoRoot, 'packages/local-store/index.js'),
      '@onderling/identity-resolver/display':    path.resolve(repoRoot, 'packages/identity-resolver/src/display.js'),
      '@onderling/identity-resolver/skills':     path.resolve(repoRoot, 'packages/identity-resolver/src/skills.js'),
      '@onderling/identity-resolver':            path.resolve(repoRoot, 'packages/identity-resolver/src/index.js'),
      '@onderling/item-store':                   path.resolve(repoRoot, 'packages/item-store/src/index.js'),
      '@onderling/notifier':                     path.resolve(repoRoot, 'packages/notifier/src/index.js'),
      '@onderling/offering-match':                  path.resolve(repoRoot, 'packages/offering-match/src/index.js'),
      '@onderling/chat-p2p':                     path.resolve(repoRoot, 'packages/chat-p2p/index.js'),

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

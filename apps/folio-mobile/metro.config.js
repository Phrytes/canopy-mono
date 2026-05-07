// Folio mobile metro.config.js — refactored 2026-05-02 to consume
// the @canopy/react-native metro-preset.
//
// The preset handles all the cross-cutting bring-up plumbing:
// NODE_BUILTINS shimming, `node:` prefix stripping, util/path/ws shim
// routing, packages/core + packages/pod-client + packages/react-native
// subpath maps, Inrupt-Node-auth + chokidar + express + systray2
// shimming, `unstable_enablePackageExports: false`.
//
// Folio's app-specific bits (`@canopy-app/folio` + its rn/*
// subpaths, @scure/bip39 + @noble/hashes pinning, app-side react/RN
// pin set) come in via options below.
//
// Detailed trap rationale + version pinning:
//   ./docs/SOLID-RN-NOTES.md       (Folio's own bring-up notes — kept)
//   packages/react-native/docs/    (folded into the substrate)

const path = require('path');
const { withCanopyPreset } = require('@canopy/react-native/metro-preset');

const projectRoot = __dirname;
const repoRoot    = path.resolve(__dirname, '../..');

module.exports = withCanopyPreset({
  projectRoot,
  repoRoot,

  // Folio-specific watch folder (the preset already adds
  // packages/core, packages/pod-client, packages/react-native).
  watchFolders: [
    path.resolve(repoRoot, 'apps/folio'),
  ],

  // Block apps/folio/node_modules (CLI-only deps mobile never reaches).
  // The preset already blocks packages/react-native/node_modules.
  extraBlockListRegExps: [
    new RegExp(
      `^${path.resolve(repoRoot, 'apps/folio/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
    ),
  ],

  // Pin React/RN/native modules to this app's node_modules so monorepo
  // hoisting can't pull in conflicting versions.
  pinToAppModules: [
    'react',
    'react-native',
    '@react-native-async-storage/async-storage',
    'react-native-ble-plx',
    'react-native-keychain',
    'react-native-screens',
    'react-native-safe-area-context',
  ],

  // Folio-specific module aliases (the preset already maps the @canopy/*
  // SDK packages).
  extraNodeModules: {
    // Folio app package (CLI/server-side code; mobile only consumes
    // the rn/* subpaths via extraSubpathResolvers below).
    '@canopy-app/folio': path.resolve(repoRoot, 'apps/folio'),

    // unstable_enablePackageExports is OFF (preset enforces), so
    // folio's package.json `exports` is ignored — pin subpath
    // resolution explicitly here for predictability.
    '@canopy-app/folio/rn/serviceFactory':  path.resolve(repoRoot, 'apps/folio/src/rn/serviceFactory.js'),
    '@canopy-app/folio/rn/backgroundTasks': path.resolve(repoRoot, 'apps/folio/src/rn/backgroundTasks.js'),

    // @scure/bip39 wordlist (subpath; same exports-OFF reason).
    '@scure/bip39/wordlists/english': path.resolve(
      projectRoot, 'node_modules/@scure/bip39/wordlists/english.js',
    ),

    // @noble/hashes: pin /crypto to the CJS browser variant.
    '@noble/hashes/crypto':    path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
    '@noble/hashes/crypto.js': path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
  },

  // The shorter `@canopy-app/folio` prefix in extraNodeModules can
  // silently override the longer `@canopy-app/folio/rn/*` subpath
  // keys — so we also resolve the rn/* prefix explicitly via a
  // resolver function (preset's first-priority hook).
  extraSubpathResolvers: [
    (moduleName, repoRootArg) => {
      if (moduleName.startsWith('@canopy-app/folio/rn/')) {
        const sub = moduleName.slice('@canopy-app/folio/rn/'.length);
        return {
          filePath: path.resolve(repoRootArg, 'apps/folio/src/rn', sub + '.js'),
          type: 'sourceFile',
        };
      }
      return null;
    },
  ],
});

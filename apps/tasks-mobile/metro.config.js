// Tasks-mobile metro.config.js — mirrors apps/stoop-mobile's setup.
//
// The @canopy/react-native metro-preset handles the cross-cutting
// bring-up plumbing (NODE_BUILTINS shimming, node: prefix, util/path/ws
// shim routing, packages/core / pod-client / react-native subpath maps,
// Inrupt-Node-auth + chokidar + express + systray2 shimming,
// unstable_enablePackageExports: false).
//
// Tasks-mobile's app-specific bits come in via options below.

const path = require('path');
const { withCanopyPreset } = require('@canopy/react-native/metro-preset');

const projectRoot = __dirname;
const repoRoot    = path.resolve(__dirname, '../..');

module.exports = withCanopyPreset({
  projectRoot,
  repoRoot,

  // Tasks-mobile imports the @canopy-app/tasks-v0 barrel for the
  // V2.8 single-agent factories (buildMeshAgent, wireSkills,
  // bundleResolver, createCrewAgent) — same platform-shell pattern
  // as stoop-mobile + folio-mobile, documented in
  // Project Files/conventions/architectural-layering.md.
  watchFolders: [
    path.resolve(repoRoot, 'apps/tasks-v0'),
    path.resolve(repoRoot, 'packages/chat-p2p'),
    path.resolve(repoRoot, 'packages/identity-resolver'),
    path.resolve(repoRoot, 'packages/item-store'),
    path.resolve(repoRoot, 'packages/local-store'),
    path.resolve(repoRoot, 'packages/notifier'),
    path.resolve(repoRoot, 'packages/oidc-session-rn'),
    path.resolve(repoRoot, 'packages/online-cadence'),
    path.resolve(repoRoot, 'packages/skill-match'),
    path.resolve(repoRoot, 'packages/sync-engine-rn'),
  ],

  // Block apps/tasks-v0/node_modules (server / CLI / web-only deps
  // mobile never reaches).
  extraBlockListRegExps: [
    new RegExp(
      `^${path.resolve(repoRoot, 'apps/tasks-v0/node_modules').replace(/[/\\]/g, '[/\\\\]')}.*`,
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
    'react-native-svg',
  ],

  // Tasks-specific module aliases (the preset already maps the @canopy/*
  // SDK packages). Same `extraNodeModules` Trap-2 caveat as stoop-mobile:
  // overlapping prefixes go via `extraSubpathResolvers` below.
  extraNodeModules: {
    '@canopy-app/tasks-v0':      path.resolve(repoRoot, 'apps/tasks-v0'),

    '@canopy/chat-p2p':          path.resolve(repoRoot, 'packages/chat-p2p'),
    '@canopy/local-store':       path.resolve(repoRoot, 'packages/local-store'),
    '@canopy/identity-resolver': path.resolve(repoRoot, 'packages/identity-resolver'),
    '@canopy/item-store':        path.resolve(repoRoot, 'packages/item-store'),
    '@canopy/notifier':          path.resolve(repoRoot, 'packages/notifier'),
    '@canopy/online-cadence':    path.resolve(repoRoot, 'packages/online-cadence'),
    '@canopy/skill-match':       path.resolve(repoRoot, 'packages/skill-match'),
    '@canopy/sync-engine-rn':    path.resolve(repoRoot, 'packages/sync-engine-rn'),
    '@canopy/oidc-session-rn':   path.resolve(repoRoot, 'packages/oidc-session-rn'),

    '@scure/bip39/wordlists/english': path.resolve(
      projectRoot, 'node_modules/@scure/bip39/wordlists/english.js',
    ),

    '@noble/hashes/crypto':    path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
    '@noble/hashes/crypto.js': path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
  },

  // Subpath resolvers for `@canopy-app/tasks-v0/<sub>` imports —
  // metro's enablePackageExports stays off (per the preset), so the
  // app's `package.json#exports` field is ignored. Same pattern as
  // stoop-mobile's `@canopy-app/stoop/{lib,locales}/*` resolvers.
  extraSubpathResolvers: [
    (moduleName, repoRoot) => {
      if (moduleName.startsWith('@canopy-app/tasks-v0/locales/')) {
        const sub = moduleName.slice('@canopy-app/tasks-v0/locales/'.length);
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/locales', sub + '.json'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@canopy-app/tasks-v0/MeshAgent')) {
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/MeshAgent.js'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@canopy-app/tasks-v0/wireSkills')) {
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/wireSkills.js'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@canopy-app/tasks-v0/bundleResolver')) {
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/bundleResolver.js'),
          type:     'sourceFile',
        };
      }
      if (moduleName.startsWith('@canopy-app/tasks-v0/Crew')) {
        return {
          filePath: path.resolve(repoRoot, 'apps/tasks-v0/src/Crew.js'),
          type:     'sourceFile',
        };
      }
      return null;
    },
  ],
});

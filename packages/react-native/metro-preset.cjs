// metro-preset — reusable Metro configuration for `@canopy` apps
// running on React Native.
//
// This preset captures the cross-cutting Metro setup that every
// `@canopy` RN app needs: NODE_BUILTINS shimming, `node:`-prefix
// stripping, util/path/ws shim routing, monorepo subpath handling,
// `unstable_enablePackageExports: false`.  See ./docs/BRING-UP-NOTES.md
// for the trap catalogue this is mitigating.
//
// Usage in an app's metro.config.js:
//
//   const path = require('path');
//   const { withCanopyPreset } =
//     require('@canopy/react-native/metro-preset');
//
//   module.exports = withCanopyPreset({
//     projectRoot: __dirname,
//     repoRoot:    path.resolve(__dirname, '../..'),
//     // optional app-specific extras:
//     watchFolders:      [path.resolve(__dirname, '../my-app-package')],
//     extraNodeModules:  { '@my-org/foo': path.resolve(__dirname, '../foo') },
//     extraBlockListRegExps: [],
//     extraSubpathResolvers: [
//       (moduleName, repoRoot) => {
//         if (moduleName.startsWith('@my-org/foo/rn/')) {
//           const sub = moduleName.slice('@my-org/foo/rn/'.length);
//           return { filePath: path.resolve(repoRoot, 'apps/foo/src/rn', sub + '.js'), type: 'sourceFile' };
//         }
//         return null;
//       },
//     ],
//     pinToAppModules: ['react', 'react-native'],   // packages to pin to app's node_modules
//   });

const path = require('path');

// `expo/metro-config` is a peer-dep of the consuming app — resolve it
// from the app's `projectRoot`, not from this preset's own location.
// Symlinked-package installs (file: deps in monorepos) place this
// preset inside `apps/<x>/node_modules/@canopy/react-native/` as a
// symlink to `packages/react-native/`; Node's CJS resolver walks up
// from the symlink target by default and won't find expo at the repo
// root.  Resolving with `paths: [projectRoot]` walks from the app's
// own node_modules instead.
function loadExpoMetroConfig(projectRoot) {
  const resolved = require.resolve('expo/metro-config', { paths: [projectRoot] });
  return require(resolved);
}

// ── Path to this package's own files. ───────────────────────────────
//
// The preset itself is at:  packages/react-native/metro-preset.cjs
// The shims are at:         packages/react-native/src/platform/shims/*.js
// The platform helpers at:  packages/react-native/src/platform/*.{js,rn.js}
const PRESET_DIR  = __dirname;
const PLATFORM_DIR = path.resolve(PRESET_DIR, 'src/platform');
const SHIMS_DIR    = path.resolve(PLATFORM_DIR, 'shims');
const SHIM_PATHS = {
  nodeBuiltins: path.resolve(SHIMS_DIR, 'node-builtins.js'),
  util:         path.resolve(SHIMS_DIR, 'util.js'),
  path:         path.resolve(SHIMS_DIR, 'path.js'),
  ws:           path.resolve(SHIMS_DIR, 'ws.js'),
};

// Platform helpers that ship a `.rn.js` variant alongside the default
// `.js`.  Metro's auto-`*.rn.js` selection only kicks in for the
// default file-system resolution path; with `unstable_enablePackageExports`
// off, subpath imports go through this preset's resolveRequest, so
// we route them explicitly.  Add new RN-variant helpers here.
const PLATFORM_RN_VARIANTS = new Set(['polyfills']);

// ── Node built-ins shimmed to a near-empty object. ──────────────────
//
// These appear in server-side SDK + app code (CLI factories, Inrupt's
// Node-only auth, chokidar/express/systray, etc.) but are never
// actually invoked on mobile.  Metro resolves dynamic imports at
// bundle time, so missing them = bundle failure even on dead-code
// paths.  Shimming to an empty-ish object lets the bundle complete.
//
// `util`, `events`, `punycode`, `buffer`, `path` are NOT in this set —
// they have real polyfill packages (`util`, `events`, `punycode`,
// `buffer`) that libraries actually invoke at runtime.  `path` has its
// own dedicated shim (SHIM_PATHS.path).
const NODE_BUILTINS = new Set([
  'http', 'https', 'net', 'tls', 'fs', 'fs/promises',
  'os', 'stream', 'zlib', 'dns', 'dgram',
  'child_process', 'cluster', 'worker_threads',
  'readline', 'repl', 'vm', 'module', 'perf_hooks',
  'assert', 'constants', 'domain', 'sys',
  'timers', 'string_decoder', 'v8',
  // Required by ws internals (sender.js, websocket-server.js)
  'crypto',
  // Required by @inrupt/solid-client-authn-node bundling chain
  'url', 'querystring', 'tty',
]);

/**
 * Build the Metro config for a `@canopy` RN app.
 *
 * @param {object} options
 * @param {string} options.projectRoot                      Absolute path of the app's root.
 * @param {string} options.repoRoot                         Absolute path of the monorepo root.
 * @param {string[]} [options.watchFolders=[]]              Extra watch folders the app needs.
 * @param {Record<string, string>} [options.extraNodeModules={}]   App-specific module aliases.
 * @param {RegExp[]} [options.extraBlockListRegExps=[]]     App-specific block-list entries.
 * @param {string[]} [options.extraNodeModulesPaths=[]]     App-specific extra node_modules search paths.
 * @param {Array<(moduleName: string, repoRoot: string, projectRoot: string) => null | {filePath: string, type: 'sourceFile'}>} [options.extraSubpathResolvers=[]]
 *   Custom subpath resolvers (return null to fall through to next).
 * @param {string[]} [options.pinToAppModules=[]]           Packages to pin to the app's own node_modules
 *   (avoids conflicting versions in monorepo node_modules).
 * @param {object} [options.extraShims={}]                  Module-name → file-path map; replaces
 *   resolution for the listed module names.  Use sparingly.
 * @returns {object}                                         Metro config object.
 */
function withCanopyPreset(options) {
  const {
    projectRoot,
    repoRoot,
    watchFolders          = [],
    extraNodeModules      = {},
    extraBlockListRegExps = [],
    extraNodeModulesPaths = [],
    extraSubpathResolvers = [],
    pinToAppModules       = [],
    extraShims            = {},
  } = options;

  if (!projectRoot) {
    throw new Error('[withCanopyPreset] projectRoot is required');
  }
  if (!repoRoot) {
    throw new Error('[withCanopyPreset] repoRoot is required');
  }

  const APP_MODULES = path.resolve(projectRoot, 'node_modules');

  // Helper: pin a list of package names to APP_MODULES.
  const pinToApp = (names) =>
    Object.fromEntries(names.map((n) => [n, path.resolve(APP_MODULES, n)]));

  // ── Start from Expo's default config. ─────────────────────────────
  const { getDefaultConfig } = loadExpoMetroConfig(projectRoot);
  const config = getDefaultConfig(projectRoot);

  // ── Watch folders (preset's monorepo defaults + app's extras). ────
  config.watchFolders = [
    ...(config.watchFolders ?? []),
    path.resolve(repoRoot, 'packages/core'),
    path.resolve(repoRoot, 'packages/pod-client'),
    path.resolve(repoRoot, 'packages/react-native'),
    path.resolve(repoRoot, 'packages/sync-engine'),
    ...watchFolders,
  ];

  // ── Block list (preset blocks substrate-package node_modules to
  //    avoid conflicting versions + Node-only deps walking into the
  //    bundle.  In particular `packages/sync-engine/node_modules`
  //    contains `chokidar`, which would otherwise be resolved by Metro
  //    inside watchFolders even though we alias the `chokidar` bare
  //    import to a shim — Metro walks the node_modules tree of every
  //    watched package on startup, and chokidar's transitive deps
  //    (e.g. readdirp) call `util.promisify(fs.readdir)`, which
  //    throws under our empty `fs` shim.). ─────────────────────────
  const blockedPkgNodeModules = [
    path.resolve(repoRoot, 'packages/react-native/node_modules'),
    path.resolve(repoRoot, 'packages/sync-engine/node_modules'),
  ];
  const existingBlockList = config.resolver?.blockList;
  const blockListEntries = existingBlockList
    ? (Array.isArray(existingBlockList) ? existingBlockList : [existingBlockList])
    : [];
  config.resolver = config.resolver ?? {};
  config.resolver.blockList = [
    ...blockListEntries,
    ...blockedPkgNodeModules.map((p) =>
      new RegExp(`^${p.replace(/[/\\]/g, '[/\\\\]')}.*`),
    ),
    ...extraBlockListRegExps,
  ];

  // ── Resolver — extraNodeModules, nodeModulesPaths, resolveRequest. ─
  config.resolver = {
    ...config.resolver,

    // Forcing exports-resolution OFF avoids Hermes' "property 'require'
    // doesn't exist" at startup when an ESM file is preferred for a
    // CJS-shaped consumer.  See BRING-UP-NOTES.md for the saga.
    unstable_enablePackageExports: false,

    extraNodeModules: {
      ...(config.resolver?.extraNodeModules ?? {}),

      // Local SDK packages — always-on.
      '@canopy/core':         path.resolve(repoRoot, 'packages/core'),
      '@canopy/pod-client':   path.resolve(repoRoot, 'packages/pod-client'),
      '@canopy/react-native': path.resolve(repoRoot, 'packages/react-native'),
      '@canopy/sync-engine':  path.resolve(repoRoot, 'packages/sync-engine'),

      // ws is Node-only; RN has globalThis.WebSocket built in.
      'ws': SHIM_PATHS.ws,

      // Inrupt's Node-only auth lib + CLI/server-only deps that mobile
      // never invokes at runtime.  Shim to an empty-ish module so the
      // bundle completes.
      '@inrupt/solid-client-authn-node': SHIM_PATHS.nodeBuiltins,
      'chokidar':                         SHIM_PATHS.nodeBuiltins,
      'express':                          SHIM_PATHS.nodeBuiltins,
      'systray2':                         SHIM_PATHS.nodeBuiltins,
      // `@canopy/relay` is the Node-side relay server (Web Push
      // sender, mDNS discovery, the local-UI HTTP shim).  Stoop's
      // `apps/stoop/src/lib/WebPushSender.js` does a dynamic import
      // of `@canopy/relay` when VAPID keys are configured — Metro
      // statically follows the dynamic `import()` and would fail
      // without this shim.  Mobile uses native Expo push instead;
      // the dynamic-import branch never fires at runtime.
      // Stoop V3 mobile Phase 40.23 trap (2026-05-08).
      '@canopy/relay':                  SHIM_PATHS.nodeBuiltins,
      // Same trap class: `web-push` is the Node Web-Push library
      // pulled by `WebPushSender`.  Mobile never reaches it.
      'web-push':                         SHIM_PATHS.nodeBuiltins,

      // Pin core React / RN packages to the app's node_modules to
      // avoid conflicting copies pulled in via monorepo hoisting.
      ...pinToApp(pinToAppModules),

      // App-defined module aliases override / extend the preset.
      ...extraNodeModules,

      // App-defined explicit shims (replace resolution for given names).
      ...extraShims,
    },

    nodeModulesPaths: [
      APP_MODULES,
      path.resolve(repoRoot, 'packages/core/node_modules'),
      path.resolve(repoRoot, 'packages/pod-client/node_modules'),
      ...extraNodeModulesPaths,
    ],

    resolveRequest: (context, moduleName, platform) => {
      // Strip `node:` prefix for builtin lookups.
      const stripped = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;

      // 1. Node built-ins → empty-ish shim.
      if (NODE_BUILTINS.has(stripped)) {
        return { filePath: SHIM_PATHS.nodeBuiltins, type: 'sourceFile' };
      }

      // 2. `util` → util shim (real polyfill + TextDecoder/TextEncoder top-up).
      if (stripped === 'util') {
        return { filePath: SHIM_PATHS.util, type: 'sourceFile' };
      }

      // 3. `path` → POSIX path shim (PathMap.js destructures `posix.join` at module load).
      if (stripped === 'path') {
        return { filePath: SHIM_PATHS.path, type: 'sourceFile' };
      }

      // 4. `ws` (and subpaths) → ws shim (RN has globalThis.WebSocket).
      if (moduleName === 'ws' || moduleName.startsWith('ws/')) {
        return { filePath: SHIM_PATHS.ws, type: 'sourceFile' };
      }

      // 5. `@canopy/react-native/platform/*` — substrate's platform
      //    helpers.  With `unstable_enablePackageExports: false` (set
      //    above), the package.json `exports` field is ignored and
      //    subpath imports must be resolved here.  Metro's `*.rn.js`
      //    auto-selection also doesn't apply when we hand-resolve, so
      //    we pick the variant manually based on platform.
      if (moduleName.startsWith('@canopy/react-native/platform/')) {
        const sub = moduleName.slice('@canopy/react-native/platform/'.length);
        const useRn = platform !== 'web' && PLATFORM_RN_VARIANTS.has(sub);
        return {
          filePath: path.resolve(PLATFORM_DIR, sub + (useRn ? '.rn.js' : '.js')),
          type: 'sourceFile',
        };
      }

      // 5b. `@canopy/sync-engine/*` — exports field is ignored
      //     because of `unstable_enablePackageExports: false`, so
      //     resolve subpaths directly against `packages/sync-engine/src/`.
      //     `chokidar` (used by adapters/watcherNode) is aliased to the
      //     empty Node-builtins shim above, so RN bundles that touch
      //     watcherNode silently get a no-op chokidar.
      if (moduleName.startsWith('@canopy/sync-engine/')) {
        const sub = moduleName.slice('@canopy/sync-engine/'.length);
        return {
          filePath: path.resolve(repoRoot, 'packages/sync-engine/src', sub + '.js'),
          type: 'sourceFile',
        };
      }

      // 6. App-defined custom subpath resolvers.
      for (const resolver of extraSubpathResolvers) {
        const result = resolver(moduleName, repoRoot, projectRoot);
        if (result) return result;
      }

      // 7. `node:`-prefixed import that wasn't a builtin → fall through to
      //    normal resolution with the prefix stripped (lets `node:events`
      //    find the real `events` polyfill in node_modules).
      if (moduleName.startsWith('node:')) {
        return context.resolveRequest(context, stripped, platform);
      }

      // 8. Default Metro resolution.
      return context.resolveRequest(context, moduleName, platform);
    },
  };

  return config;
}

module.exports = { withCanopyPreset, NODE_BUILTINS };

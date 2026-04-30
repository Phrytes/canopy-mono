// Why this file is so long:
// see docs/SOLID-RN-NOTES.md for the full backstory + audit checklist.
// Quick map:
//   - NODE_BUILTINS (below) — server-only Node builtins shimmed to
//     `shims/node-builtins.js` (empty-ish object with lazy getters).
//   - `util`, `events`, `punycode` are NOT in NODE_BUILTINS — they have
//     real polyfill packages installed and routed through normal
//     resolution, because libraries actually invoke them at runtime
//     (whatwg-url's punycode.ucs2.decode, EventEmitter subclassing, etc.).
//   - `node:` prefix is stripped in `resolveRequest`.
//   - `@canopy-app/folio/rn/*` subpath imports are intercepted in
//     `resolveRequest` because Metro's `extraNodeModules` doesn't
//     reliably match subpath keys when a shorter prefix (`@canopy-app/folio`)
//     is also present.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const repoRoot  = path.resolve(__dirname, '../..');
const shimPath  = path.resolve(__dirname, 'shims/node-builtins.js');

// Node.js built-ins that appear in server-side SDK + Folio code (CLI
// _podFactory, OidcSession's @inrupt/* import chain, chokidar watcher)
// but are never called on mobile.  Metro resolves dynamic imports at
// bundle time, so we shim them to prevent "module not found" errors
// without breaking runtime behaviour.
// `util`, `events`, `punycode`, `buffer`, `path` deliberately omitted
// — they have real implementations available.  `util/events/punycode/
// buffer` come from npm polyfills via normal resolution; `path` is
// shimmed via shims/path.js (pure-JS POSIX helpers — no npm polyfill
// needed since RN's FS is always `/`-separated and PathMap.js
// destructures `posix` at module-load time).
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

// Force all native / React modules to resolve from THIS app's node_modules.
const APP_MODULES = path.resolve(__dirname, 'node_modules');
const pinToApp = (...names) =>
  Object.fromEntries(names.map(n => [n, path.resolve(APP_MODULES, n)]));

const config = getDefaultConfig(__dirname);

config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(repoRoot, 'packages/core'),
  path.resolve(repoRoot, 'packages/pod-client'),
  path.resolve(repoRoot, 'packages/react-native'),
  path.resolve(repoRoot, 'apps/folio'),
];

// Block Metro from bundling files inside packages/react-native/node_modules
// (the SDK package's own dev environment, with conflicting versions) and
// inside apps/folio/node_modules (CLI-only deps like chokidar, express,
// systray2 that the mobile app never reaches at runtime).
const rnPkgNodeModules    = path.resolve(repoRoot, 'packages/react-native/node_modules');
const folioNodeModules    = path.resolve(repoRoot, 'apps/folio/node_modules');
const existingBlockList   = config.resolver?.blockList;
const blockListEntries    = existingBlockList
  ? (Array.isArray(existingBlockList) ? existingBlockList : [existingBlockList])
  : [];
config.resolver = config.resolver ?? {};
config.resolver.blockList = [
  ...blockListEntries,
  new RegExp(`^${rnPkgNodeModules.replace(/[/\\]/g, '[/\\\\]')}.*`),
  new RegExp(`^${folioNodeModules.replace(/[/\\]/g, '[/\\\\]')}.*`),
];

config.resolver = {
  ...config.resolver,

  // Same rationale as mesh-demo: forcing exports-resolution OFF avoids
  // Hermes' "property 'require' doesn't exist" at startup when an ESM
  // file is preferred for a CJS-shaped consumer.
  unstable_enablePackageExports: false,

  extraNodeModules: {
    ...(config.resolver?.extraNodeModules ?? {}),

    // Local SDK packages
    '@canopy/core':         path.resolve(repoRoot, 'packages/core'),
    '@canopy/pod-client':   path.resolve(repoRoot, 'packages/pod-client'),
    '@canopy/react-native': path.resolve(repoRoot, 'packages/react-native'),
    '@canopy-app/folio':    path.resolve(repoRoot, 'apps/folio'),

    // Explicit subpath maps for the Folio engine adapters used by this app.
    // unstable_enablePackageExports is OFF (see comment above), so folio's
    // package.json `exports` field is ignored; we map the public API
    // surface here instead.
    '@canopy-app/folio/rn/serviceFactory':  path.resolve(repoRoot, 'apps/folio/src/rn/serviceFactory.js'),
    '@canopy-app/folio/rn/backgroundTasks': path.resolve(repoRoot, 'apps/folio/src/rn/backgroundTasks.js'),

    // ws is Node.js-only; RN has globalThis.WebSocket built in.
    'ws': path.resolve(__dirname, 'shims/ws.js'),

    // Inrupt's Node-only auth lib pulls in tons of Node built-ins.
    // Mobile auth is via expo-auth-session (see src/auth/folioAuth.js)
    // so this never needs to resolve to real code.
    '@inrupt/solid-client-authn-node': path.resolve(__dirname, 'shims/node-builtins.js'),
    'chokidar':                         path.resolve(__dirname, 'shims/node-builtins.js'),
    'express':                          path.resolve(__dirname, 'shims/node-builtins.js'),
    'systray2':                         path.resolve(__dirname, 'shims/node-builtins.js'),

    // Explicit subpath resolutions (replaces unstable_enablePackageExports).
    '@scure/bip39/wordlists/english': path.resolve(APP_MODULES, '@scure/bip39/wordlists/english.js'),

    // @noble/hashes: pin /crypto to the CJS browser variant.
    '@noble/hashes/crypto':    path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),
    '@noble/hashes/crypto.js': path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),

    // Pin core React / RN packages to the app's copies.
    ...pinToApp(
      'react',
      'react-native',
      '@react-native-async-storage/async-storage',
      'react-native-ble-plx',
      'react-native-keychain',
      'react-native-screens',
      'react-native-safe-area-context',
    ),
  },

  nodeModulesPaths: [
    path.resolve(__dirname, 'node_modules'),
    path.resolve(repoRoot, 'packages/core/node_modules'),
    path.resolve(repoRoot, 'packages/pod-client/node_modules'),
  ],

  resolveRequest: (context, moduleName, platform) => {
    // Accept both 'crypto' and 'node:crypto' forms for Node builtins.
    const stripped = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
    if (NODE_BUILTINS.has(stripped)) {
      return { filePath: shimPath, type: 'sourceFile' };
    }
    // `util` needs a polyfill PLUS TextDecoder/TextEncoder top-up
    // (whatwg-url destructures them and the bare `util` package
    // doesn't export them).  See shims/util.js.
    if (stripped === 'util') {
      return { filePath: path.resolve(__dirname, 'shims/util.js'), type: 'sourceFile' };
    }
    // `path` needs a real POSIX impl — PathMap.js destructures
    // `posix.join` at module-load time.  See shims/path.js.
    if (stripped === 'path') {
      return { filePath: path.resolve(__dirname, 'shims/path.js'), type: 'sourceFile' };
    }
    if (moduleName === 'ws' || moduleName.startsWith('ws/')) {
      return { filePath: path.resolve(__dirname, 'shims/ws.js'), type: 'sourceFile' };
    }
    // Folio RN subpath imports.  unstable_enablePackageExports is OFF, so
    // Metro can't read folio's package.json `exports`; and the
    // `extraNodeModules` subpath keys are silently overridden by the
    // shorter `@canopy-app/folio` prefix.  Resolve explicitly here.
    if (moduleName.startsWith('@canopy-app/folio/rn/')) {
      const sub = moduleName.slice('@canopy-app/folio/rn/'.length);
      return {
        filePath: path.resolve(repoRoot, 'apps/folio/src/rn', sub + '.js'),
        type: 'sourceFile',
      };
    }
    // `node:events` → `events` (real polyfill in node_modules).  Same
    // trick for any other node:-prefixed import that doesn't match
    // NODE_BUILTINS above — let normal resolution find the polyfill.
    if (moduleName.startsWith('node:')) {
      return context.resolveRequest(context, stripped, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;

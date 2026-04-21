const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const shimPath  = path.resolve(__dirname, 'shims/node-builtins.js');

// Node.js built-ins that appear in server-side SDK code (A2ATransport,
// FileSystemSource, VaultNodeFs, etc.) but are never called on mobile.
// Metro resolves dynamic imports at bundle time, so we shim them to prevent
// "module not found" errors without breaking runtime behaviour.
const NODE_BUILTINS = new Set([
  'http', 'https', 'net', 'tls', 'fs', 'fs/promises',
  'path', 'os', 'stream', 'zlib', 'dns', 'dgram',
  'child_process', 'cluster', 'worker_threads',
  'readline', 'repl', 'vm', 'module', 'perf_hooks',
  'assert', 'constants', 'domain', 'punycode', 'sys',
  'timers', 'string_decoder', 'v8',
  // Required by ws internals (sender.js, websocket-server.js)
  'crypto', 'events', 'buffer',
]);

// Force all native / React modules to resolve from THIS app's node_modules.
// Without this, Metro might find a different version living in
// packages/react-native/node_modules (its own dev env) and trigger
// "duplicate native module" warnings in expo doctor.
const APP_MODULES = path.resolve(__dirname, 'node_modules');
const pinToApp = (...names) =>
  Object.fromEntries(names.map(n => [n, path.resolve(APP_MODULES, n)]));

const config = getDefaultConfig(__dirname);

config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(repoRoot, 'packages/core'),
  path.resolve(repoRoot, 'packages/react-native'),
];

// Block Metro from bundling files inside packages/react-native/node_modules.
// That directory is the SDK package's own dev environment (react-native 0.85,
// react-native-keychain 10, etc.) — wrong versions for this app.  All imports
// of those packages are already redirected to the app's node_modules via
// extraNodeModules above, so nothing in the bundle needs these paths.
const rnPkgNodeModules = path.resolve(repoRoot, 'packages/react-native/node_modules');
const existingBlockList = config.resolver?.blockList;
const blockListEntries = existingBlockList
  ? (Array.isArray(existingBlockList) ? existingBlockList : [existingBlockList])
  : [];
config.resolver = config.resolver ?? {};
config.resolver.blockList = [
  ...blockListEntries,
  new RegExp(`^${rnPkgNodeModules.replace(/[/\\]/g, '[/\\\\]')}.*`),
];

config.resolver = {
  ...config.resolver,

  // Do NOT enable unstable_enablePackageExports — when combined with packages
  // that have "type":"module" (like @canopy/core), Metro marks those files as
  // ESM and Hermes executes them without `require` in scope, crashing on startup.
  // All subpath imports that need the "exports" field are handled explicitly below.

  extraNodeModules: {
    ...(config.resolver?.extraNodeModules ?? {}),

    // Local SDK packages
    '@canopy/core':         path.resolve(repoRoot, 'packages/core'),
    '@canopy/react-native': path.resolve(repoRoot, 'packages/react-native'),

    // ws is Node.js-only; RN has globalThis.WebSocket built in
    'ws': path.resolve(__dirname, 'shims/ws.js'),

    // Explicit subpath resolutions (replaces the need for unstable_enablePackageExports)
    '@scure/bip39/wordlists/english': path.resolve(APP_MODULES, '@scure/bip39/wordlists/english.js'),
    // @noble/hashes exports "./crypto" without .js extension; Metro warns on "./crypto.js" imports
    '@noble/hashes/crypto.js': path.resolve(repoRoot, 'packages/core/node_modules/@noble/hashes/crypto.js'),

    // Pin core React / RN packages to the app's copies
    ...pinToApp(
      'react',
      'react-native',
      '@react-native-async-storage/async-storage',
      'react-native-ble-plx',
      'react-native-keychain',
      'react-native-zeroconf',
      'react-native-screens',
      'react-native-safe-area-context',
    ),
  },

  // Allow Metro to find @canopy/core's transitive deps (tweetnacl, @scure/bip39, etc.)
  // from packages/core/node_modules when processing files inside packages/core/src/.
  // NOTE: we intentionally omit packages/react-native/node_modules here because that
  // directory has conflicting versions of react-native, react-native-ble-plx, etc.
  // that would cause expo-doctor to report duplicate native modules.
  nodeModulesPaths: [
    path.resolve(__dirname, 'node_modules'),
    path.resolve(repoRoot, 'packages/core/node_modules'),
  ],

  // Shim Node.js built-ins (server-only SDK code is never called on mobile)
  resolveRequest: (context, moduleName, platform) => {
    if (NODE_BUILTINS.has(moduleName)) {
      return { filePath: shimPath, type: 'sourceFile' };
    }
    // ws uses Node crypto/stream/events internally — shim the whole package
    // regardless of which directory the import originates from.
    if (moduleName === 'ws' || moduleName.startsWith('ws/')) {
      return { filePath: path.resolve(__dirname, 'shims/ws.js'), type: 'sourceFile' };
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;

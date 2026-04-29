const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const repoRoot  = path.resolve(__dirname, '../..');
const shimPath  = path.resolve(__dirname, 'shims/node-builtins.js');

// Node.js built-ins that appear in server-side SDK code (A2ATransport,
// FileSystemSource, VaultNodeFs, pod-client server pieces, etc.) but are
// never called on mobile.  Metro resolves dynamic imports at bundle time,
// so we shim them to prevent "module not found" errors without breaking
// runtime behaviour.
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
const APP_MODULES = path.resolve(__dirname, 'node_modules');
const pinToApp = (...names) =>
  Object.fromEntries(names.map(n => [n, path.resolve(APP_MODULES, n)]));

const config = getDefaultConfig(__dirname);

config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(repoRoot, 'packages/core'),
  path.resolve(repoRoot, 'packages/pod-client'),
  path.resolve(repoRoot, 'packages/react-native'),
];

// Block Metro from bundling files inside packages/react-native/node_modules
// (the SDK package's own dev environment, with conflicting versions).
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

    // ws is Node.js-only; RN has globalThis.WebSocket built in.
    'ws': path.resolve(__dirname, 'shims/ws.js'),

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
      'react-native-zeroconf',
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
    if (NODE_BUILTINS.has(moduleName)) {
      return { filePath: shimPath, type: 'sourceFile' };
    }
    if (moduleName === 'ws' || moduleName.startsWith('ws/')) {
      return { filePath: path.resolve(__dirname, 'shims/ws.js'), type: 'sourceFile' };
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;

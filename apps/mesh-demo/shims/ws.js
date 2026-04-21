/**
 * Shim: replace the `ws` npm package with React Native's global WebSocket.
 *
 * RelayTransport checks `globalThis.WebSocket` at runtime and only falls back
 * to `import('ws')` in Node.js environments. Metro follows the import
 * statically, so we redirect it here to avoid bundling ws + its Node deps
 * (crypto, stream, etc.) that don't exist in the RN runtime.
 */
module.exports = globalThis.WebSocket;

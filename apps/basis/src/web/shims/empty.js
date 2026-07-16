/**
 * Empty-module shim for Node-only deps that the browser bundle
 * doesn't actually execute at runtime (the corresponding code paths
 * are guarded by `typeof X !== 'undefined'` checks for the browser-
 * native equivalent).
 *
 * Used via vite.config.js `resolve.alias` to replace:
 *   - `ws`            — RelayTransport uses globalThis.WebSocket in browsers
 *   - other future Node-only deps that the Agent's hot path doesn't touch
 *
 * Exporting `{}` keeps `await import('ws')` working as a no-op rather
 * than a runtime error; the surrounding code path is unreachable in
 * browsers anyway.
 */
export default {};

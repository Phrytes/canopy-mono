/**
 * Empty shim for Node.js built-in modules that are imported by server-side
 * SDK code (e.g. A2ATransport, FileSystemSource, VaultNodeFs, pod-client
 * server pieces).  These are never called on mobile — the shim just prevents
 * Metro from failing when it encounters the import at bundle time.
 */
module.exports = {};

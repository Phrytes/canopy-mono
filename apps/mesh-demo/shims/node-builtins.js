/**
 * Empty shim for Node.js built-in modules that are imported by server-side
 * SDK code (e.g. A2ATransport, FileSystemSource, VaultNodeFs).
 *
 * These modules are never actually called on mobile — the shim just prevents
 * Metro from failing when it encounters the import at bundle time.
 */
module.exports = {};

/**
 * Empty shim for Node.js built-in modules that are imported by server-side
 * Folio + SDK code (cli/_podFactory's `node:fs`, OidcSession's
 * `@inrupt/solid-client-authn-node`, the chokidar watcher path, etc.) but
 * which the mobile app never actually invokes.  These imports happen at
 * module-load time, so we shim them to prevent Metro from failing at
 * bundle time without breaking runtime behaviour.
 */
module.exports = {};

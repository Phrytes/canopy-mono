/**
 * Shim for Node.js built-in modules that are imported by server-side
 * Folio + SDK code (cli/_podFactory's `node:fs`, OidcSession's
 * `@inrupt/solid-client-authn-node`, the chokidar watcher path, etc.) but
 * which the mobile app never actually invokes.  These imports happen at
 * module-load time, so we shim them to prevent Metro from failing at
 * bundle time without breaking runtime behaviour.
 *
 * If you're here because of a fresh "Cannot read property 'X' of
 * undefined" error: see ../docs/SOLID-RN-NOTES.md for the audit
 * checklist + the difference between "bundled but never invoked"
 * (empty shim is fine) vs "actually called at runtime" (need a real
 * polyfill).
 *
 * We re-export the few primitives RN already provides as globals.  Some
 * libraries (whatwg-url, urls polyfills) destructure these from the
 * Node module rather than reaching for the global, so an empty `{}`
 * shim breaks them at runtime even when the rest of the module is
 * unused.
 */
// Use lazy getters: globalThis.URL / URLSearchParams are installed by RN
// after this shim file evaluates, so eager reads cache `undefined`.
Object.defineProperties(module.exports, {
  TextDecoder:     { get: () => globalThis.TextDecoder,     enumerable: true },
  TextEncoder:     { get: () => globalThis.TextEncoder,     enumerable: true },
  URL:             { get: () => globalThis.URL,             enumerable: true },
  URLSearchParams: { get: () => globalThis.URLSearchParams, enumerable: true },
});

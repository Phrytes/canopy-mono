/**
 * `util` shim that wraps the real npm `util` polyfill and tops it up with
 * TextDecoder / TextEncoder from globalThis.  The polyfill (`util@^0.12`)
 * provides classic Node util (`inherits`, `format`, `inspect`, …) but
 * does NOT export TextDecoder / TextEncoder, which Node added later.
 *
 * whatwg-url destructures `const { TextDecoder } = require('util')` at
 * module-load time; without this top-up the destructured value is
 * undefined and URL parsing fails with "Cannot read property 'decode'
 * of undefined".
 *
 * Lazy getters: globalThis.TextDecoder is installed by Hermes/RN early
 * but after some user bundle code; the getter defers the lookup until
 * the destructure executes.
 */
const realUtil = require('util/');   // trailing slash forces resolution to node_modules/util/
module.exports = realUtil;
Object.defineProperties(module.exports, {
  TextDecoder: {
    configurable: true,
    enumerable:   true,
    get() { return globalThis.TextDecoder; },
  },
  TextEncoder: {
    configurable: true,
    enumerable:   true,
    get() { return globalThis.TextEncoder; },
  },
});

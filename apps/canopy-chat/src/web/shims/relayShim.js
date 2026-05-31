/**
 * Browser-safe shim for `@canopy/relay`.
 *
 * `@canopy/relay` is a Node-only HTTP server package; only stoop's
 * WebPushSender uses it (`import { PushSender } from '@canopy/relay'`).
 * In the browser bundle that code path is unreachable (no VAPID keys
 * are configured), but Rollup walks the static import graph anyway.
 *
 * Shim exports just the names browser-side static imports reference;
 * classes throw at construction so accidental use surfaces the bug.
 *
 * See #303.
 */

class BrowserOnlyClass {
  constructor() {
    throw new Error('@canopy/relay is a Node-only server package and is not available in the browser');
  }
}

export const PushSender         = BrowserOnlyClass;
export const RelayTransport     = BrowserOnlyClass;
export const GroupAuthVerifier  = BrowserOnlyClass;

export default { PushSender, RelayTransport, GroupAuthVerifier };

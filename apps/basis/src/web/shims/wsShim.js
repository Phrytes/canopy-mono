/**
 * Browser-safe shim for the `ws` package.
 *
 * `ws` is a Node-only WebSocket library; relay code paths import it
 * statically (`import { WebSocketServer } from 'ws'`).  In the browser
 * `globalThis.WebSocket` is used instead via @onderling/core's transport
 * detection, so the `ws` code path is unreachable.  The shim just needs
 * the named exports Rollup sees at build time.
 *
 * See #303.
 */

class BrowserOnlyClass {
  constructor() {
    throw new Error('ws is a Node-only WebSocket library — use globalThis.WebSocket in the browser');
  }
}

export const WebSocketServer = BrowserOnlyClass;
export const WebSocket       = globalThis.WebSocket ?? BrowserOnlyClass;
export const createWebSocketStream = () => { throw new Error('ws is not available in the browser'); };

export default { WebSocketServer, WebSocket, createWebSocketStream };

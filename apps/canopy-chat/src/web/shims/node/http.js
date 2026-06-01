/**
 * Browser-safe shim for `node:http` (and `http` — same module,
 * dual-aliased in vite.config.js).
 *
 * Aliased via vite.config.js → resolve.alias.  Static `import { createServer
 * } from 'node:http'` comes from @canopy/core's A2ATransport (HTTP server
 * is Node-only; constructed only when `opts.port` is set, which browser
 * callers never do).  `@canopy/relay`'s server.js also imports `node:http`,
 * but the whole `@canopy/relay` package is already aliased to relayShim.js
 * at the boundary.
 *
 * `createServer` throws if called.  Other names (Server, ClientRequest,
 * IncomingMessage, ServerResponse, request, get, METHODS, STATUS_CODES,
 * Agent, globalAgent) are stubbed to surface the wiring bug.
 */

const browserStub = (name) => () => {
  throw new Error(
    `[node:http.${name}] called in the browser bundle — should be unreachable. ` +
    `Use fetch / globalThis.WebSocket for browser HTTP needs.`,
  );
};

class BrowserOnlyClass {
  constructor() {
    throw new Error('node:http class is not available in the browser');
  }
}

export const createServer  = browserStub('createServer');
export const request       = browserStub('request');
export const get           = browserStub('get');
export const Server        = BrowserOnlyClass;
export const ClientRequest = BrowserOnlyClass;
export const IncomingMessage = BrowserOnlyClass;
export const ServerResponse = BrowserOnlyClass;
export const Agent         = BrowserOnlyClass;
export const globalAgent   = null;

export const METHODS = Object.freeze([
  'ACL','BIND','CHECKOUT','CONNECT','COPY','DELETE','GET','HEAD',
  'LINK','LOCK','M-SEARCH','MERGE','MKACTIVITY','MKCALENDAR','MKCOL',
  'MOVE','NOTIFY','OPTIONS','PATCH','POST','PROPFIND','PROPPATCH',
  'PURGE','PUT','REBIND','REPORT','SEARCH','SOURCE','SUBSCRIBE',
  'TRACE','UNBIND','UNLINK','UNLOCK','UNSUBSCRIBE',
]);

export const STATUS_CODES = Object.freeze({
  200: 'OK', 201: 'Created', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
  404: 'Not Found', 500: 'Internal Server Error',
});

export default {
  createServer, request, get,
  Server, ClientRequest, IncomingMessage, ServerResponse,
  Agent, globalAgent, METHODS, STATUS_CODES,
};

/**
 * createMcpServer.js — wire tools/list + tools/call over an INJECTED transport.
 *
 * ┌─ DEFERRED (real driver) ────────────────────────────────────────────────┐
 * │ There is NO real MCP server here: no stdio pipe, no HTTP server, no SSE  │
 * │ stream, no sockets, and no auth-token handshake. Exactly like the        │
 * │ `NetworkTransport` in `@canopy/transports` injects its channel and       │
 * │ defers the real network driver, this injects a message transport and     │
 * │ defers the real stdio / HTTP+SSE server + the MCP auth-token handshake    │
 * │ (the org roadmap's "MCP-koppeling: HTTP/SSE + token"). Tests drive it     │
 * │ with a mock loopback (see createLoopbackPair). Standing up the real      │
 * │ server + token handshake is the remaining tail of this seam.             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * The injected `transport` is a `{ send, onMessage }` pair carrying MCP
 * JSON-RPC-ish messages. Two methods are served:
 *   • `tools/list` → `manifestToMcpTools(manifest)`
 *   • `tools/call` → `handleMcpToolCall(agent, params, dispatch+manifest)`
 *       (routes THROUGH the gate; see handleMcpToolCall.js)
 * The `manifest` is always passed to the inbound handler so the server only
 * ever dispatches tools it actually advertises (unknown-tool guard).
 */

import { manifestToMcpTools } from './manifestToMcpTools.js';
import { handleMcpToolCall }  from './handleMcpToolCall.js';
import { mcpError }           from './mcpShapes.js';

/**
 * @param {object} p
 * @param {import('@canopy/core').Agent} p.agent
 * @param {import('@canopy/app-manifest').Manifest} p.manifest
 * @param {{ send: (msg:object)=>void, onMessage: (handler:(msg:object)=>void)=>void }} p.transport
 * @param {object} [p.dispatch] — forwarded to handleMcpToolCall (registry|target, skillId, timeout…)
 * @returns {{ toolsList: () => object, handleMessage: (msg:object) => Promise<void> }}
 */
export function createMcpServer({ agent, manifest, transport, dispatch = {} }) {
  if (!transport || typeof transport.send !== 'function' || typeof transport.onMessage !== 'function') {
    throw new Error('createMcpServer: transport must be a { send, onMessage } pair');
  }

  const toolsList = () => manifestToMcpTools(manifest);

  const handleMessage = async (message) => {
    const { id, method, params } = message ?? {};
    let result;
    if (method === 'tools/list') {
      result = toolsList();
    } else if (method === 'tools/call') {
      result = await handleMcpToolCall(agent, params ?? {}, { ...dispatch, manifest });
    } else {
      result = mcpError(`Unknown method: ${method}`, { code: 'unknown_method' });
    }
    transport.send({ jsonrpc: '2.0', id, result });
  };

  transport.onMessage(handleMessage);
  return { toolsList, handleMessage };
}

/**
 * A mock in-memory loopback transport pair for tests (NO real I/O).
 *
 * Returns `{ server, client }` — two `{ send, onMessage }` endpoints wired so
 * `client.send(msg)` is delivered to the server's handler and vice-versa.
 * `client.request(msg)` is a convenience that sends and resolves with the
 * matching-`id` reply. This stands in for the DEFERRED real stdio/HTTP+SSE
 * channel (mirrors how the #63 tests use an InternalBus loopback).
 */
export function createLoopbackPair() {
  let serverHandler = null;
  let clientHandler = null;

  const server = {
    send:      (msg) => { clientHandler?.(msg); },
    onMessage: (h)   => { serverHandler = h; },
  };
  const client = {
    send:      (msg) => { serverHandler?.(msg); },
    onMessage: (h)   => { clientHandler = h; },
    request:   (msg) => new Promise((resolve) => {
      const id = msg?.id ?? cryptoRandomId();
      const prev = clientHandler;
      clientHandler = (reply) => {
        if (reply?.id === id) { clientHandler = prev; resolve(reply); }
        else prev?.(reply);
      };
      serverHandler?.({ ...msg, id });
    }),
  };
  return { server, client };
}

let __seq = 0;
function cryptoRandomId() { return `req-${++__seq}`; }

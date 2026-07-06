/**
 * mcpSession.js — the MCP lifecycle (initialize handshake + capability
 * negotiation) over a JSON-RPC 2.0 / NDJSON line stream.
 *
 * This is the next concrete layer below `createMcpServer` (the abstract
 * `{send,onMessage}` transport). Where that server assumes framed message
 * OBJECTS already arrive, this drives the real MCP wire lifecycle a stdio
 * server would run:
 *
 *   client → `initialize` (protocolVersion + client capabilities)
 *   server → result { protocolVersion, capabilities:{ tools }, serverInfo }
 *   client → `notifications/initialized`  (a notification — no reply)
 *   … only NOW are `tools/list` / `tools/call` served …
 *   client → `tools/list`  → the projected manifest tools
 *   client → `tools/call`  → routes through the EXISTING handleMcpToolCall
 *                            (so the capability gate still holds — NOT bypassed)
 *
 * A `tools/*` request before the handshake completes is rejected with a JSON-RPC
 * ServerError (per the MCP spec: only `initialize`/`ping` are valid before the
 * session is initialized). `ping` is answered at any time.
 *
 * Error semantics (see jsonRpc.js): a gate DENY / unknown TOOL / skill throw
 * keeps the MCP `{ isError:true }` tool-result and is returned inside a JSON-RPC
 * SUCCESS `result`. A protocol failure — unknown METHOD, a pre-initialize
 * tools/* call, a malformed line — is a JSON-RPC `error` object.
 *
 * ┌─ DEFERRED (real driver) ────────────────────────────────────────────────┐
 * │ `createStdioMcpServer` binds this lifecycle to an INJECTED line stream    │
 * │ (`input.onData` / `output.write`). Binding that seam to a REAL child      │
 * │ process's stdio (`child.stdout` → onData, `child.stdin` → write) or an OS │
 * │ pipe — i.e. spawning an MCP client and managing that process — is the     │
 * │ remaining tail. We are proving the WIRE PROTOCOL (framing + lifecycle +   │
 * │ gate), not the process management. Real HTTP+SSE transport is likewise    │
 * │ still DEFERRED. NO child_process / stdio / sockets are used here.          │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { manifestToMcpTools } from './manifestToMcpTools.js';
import { handleMcpToolCall }  from './handleMcpToolCall.js';
import {
  JsonRpcErrorCode,
  jsonRpcResult,
  jsonRpcError,
  jsonRpcRequest,
  jsonRpcNotification,
  encodeLine,
  createNdjsonDecoder,
} from './jsonRpc.js';

/**
 * MCP protocol versions this bridge understands. The list is date-stamped per
 * the MCP spec's versioning; `PROTOCOL_VERSIONS[0]` is our preferred version.
 *
 * APPROXIMATION: these version strings match the published MCP revisions, but
 * this bridge only implements the `initialize`/`initialized` + `tools/*` +
 * `ping` subset — not the full per-revision feature set. Negotiation echoes the
 * client's requested version when we recognise it, else offers our preferred.
 */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const SERVER_INFO = { name: '@canopy/mcp-bridge', version: '0.1.0' };

function negotiateVersion(clientVersion) {
  if (typeof clientVersion === 'string' && PROTOCOL_VERSIONS.includes(clientVersion)) {
    return clientVersion;
  }
  return PROTOCOL_VERSIONS[0];
}

/**
 * Create an MCP session over framed message OBJECTS. Transport-agnostic: feed it
 * decoded JSON-RPC messages via `handle(msg)`; it returns the reply message
 * object (or `null` for a notification, which never gets a reply). The stdio
 * server below wraps this with the NDJSON codec.
 *
 * @param {object} p
 * @param {import('@canopy/core').Agent} p.agent
 * @param {import('@canopy/app-manifest').Manifest} p.manifest
 * @param {object} [p.dispatch] — forwarded to handleMcpToolCall (registry|target, skillId, timeout…)
 * @returns {{ handle:(msg:object)=>Promise<object|null>, get state():string, toolsList:()=>object }}
 */
export function createMcpSession({ agent, manifest, dispatch = {} }) {
  // 'uninitialized' → (initialize request) → 'initializing' → (initialized note) → 'ready'
  let state = 'uninitialized';
  let clientCapabilities = null;
  let clientInfo = null;

  const toolsList = () => manifestToMcpTools(manifest);

  function handleInitialize(id, params) {
    if (state !== 'uninitialized') {
      return jsonRpcError(id, JsonRpcErrorCode.InvalidRequest, 'Session already initialized');
    }
    clientCapabilities = params?.capabilities ?? {};
    clientInfo = params?.clientInfo ?? null;
    state = 'initializing';
    return jsonRpcResult(id, {
      protocolVersion: negotiateVersion(params?.protocolVersion),
      capabilities: { tools: { listChanged: false } }, // we advertise the `tools` capability
      serverInfo: SERVER_INFO,
    });
  }

  function requireReady(id, method) {
    if (state === 'ready') return null;
    return jsonRpcError(
      id,
      JsonRpcErrorCode.ServerError,
      `Received "${method}" before initialization completed (state: ${state})`,
    );
  }

  async function handle(msg) {
    // Envelope check — must be JSON-RPC 2.0.
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return jsonRpcError(msg?.id ?? null, JsonRpcErrorCode.InvalidRequest, 'Invalid JSON-RPC 2.0 request');
    }

    const { id, method, params } = msg;
    const isNotification = id === undefined;

    // Notifications never receive a reply.
    if (isNotification) {
      if (method === 'notifications/initialized' || method === 'initialized') {
        if (state === 'initializing') state = 'ready';
      }
      // Other notifications (e.g. cancelled) are accepted and ignored.
      return null;
    }

    switch (method) {
      case 'initialize':
        return handleInitialize(id, params);

      case 'ping':
        // A trivial liveness check, valid in any state.
        return jsonRpcResult(id, {});

      case 'tools/list': {
        const notReady = requireReady(id, method);
        if (notReady) return notReady;
        return jsonRpcResult(id, toolsList());
      }

      case 'tools/call': {
        const notReady = requireReady(id, method);
        if (notReady) return notReady;
        // Routes THROUGH the existing gated path. The returned MCP tool-result
        // (possibly { isError:true } on a gate deny) is framed as a JSON-RPC
        // SUCCESS — the gate outcome is a tool-level result, not a transport error.
        const result = await handleMcpToolCall(agent, params ?? {}, { ...dispatch, manifest });
        return jsonRpcResult(id, result);
      }

      default:
        return jsonRpcError(id, JsonRpcErrorCode.MethodNotFound, `Method not found: ${method}`);
    }
  }

  return {
    handle,
    toolsList,
    get state() { return state; },
    get clientCapabilities() { return clientCapabilities; },
    get clientInfo() { return clientInfo; },
  };
}

/**
 * The INJECTED-stream seam. Bind the MCP session to a line stream:
 *
 *   • `input`  — `{ onData(cb) }`  where `cb(chunk:string)` is called with each
 *     incoming raw chunk (may hold partial / multiple NDJSON lines).
 *   • `output` — `{ write(str) }`  which receives each outgoing NDJSON line.
 *
 * This is the simplest testable shape and maps 1:1 onto real stdio: a real
 * driver would wire `child.stdout.on('data', cb)` → `input.onData` and
 * `child.stdin.write` → `output.write` (that binding is the DEFERRED step).
 *
 * Incoming chunks are decoded (line-buffered) into JSON-RPC messages, each
 * handled by the session; the reply line is written back. A malformed line is
 * answered with a JSON-RPC ParseError (id:null) rather than crashing the stream.
 * Requests are processed in arrival order (replies serialized on a promise
 * chain) so ordering is deterministic.
 *
 * @param {object} p
 * @param {import('@canopy/core').Agent} p.agent
 * @param {import('@canopy/app-manifest').Manifest} p.manifest
 * @param {{ onData:(cb:(chunk:string)=>void)=>void }} p.input
 * @param {{ write:(str:string)=>void }} p.output
 * @param {object} [p.dispatch]
 * @returns {{ session:object, decoder:object }}
 */
export function createStdioMcpServer({ agent, manifest, input, output, dispatch = {} }) {
  if (!input || typeof input.onData !== 'function') {
    throw new Error('createStdioMcpServer: input must be a { onData(cb) } stream');
  }
  if (!output || typeof output.write !== 'function') {
    throw new Error('createStdioMcpServer: output must be a { write(str) } stream');
  }

  const session = createMcpSession({ agent, manifest, dispatch });

  // Serialize reply ordering across async tool-calls.
  let chain = Promise.resolve();

  const decoder = createNdjsonDecoder({
    onMessage: (msg) => {
      chain = chain.then(async () => {
        const reply = await session.handle(msg);
        if (reply) output.write(encodeLine(reply)); // notifications → null → no reply
      });
    },
    onError: ({ error }) => {
      output.write(encodeLine(jsonRpcError(null, JsonRpcErrorCode.ParseError, `Parse error: ${error?.message ?? error}`)));
    },
  });

  input.onData((chunk) => decoder.push(chunk));

  return { session, decoder };
}

/**
 * An in-memory duplex loopback for tests (NO real I/O). Returns two connected
 * endpoints `{ a, b }`, each `{ onData, write }`. Writing to one endpoint
 * delivers to the OTHER endpoint's `onData` subscribers — so `a` and `b` are the
 * two ends of a bidirectional pipe. Stands in for the DEFERRED real stdio pipe.
 *
 * Typical wiring: give one end to the server and drive the other as the client.
 *   const { a: clientEnd, b: serverEnd } = createDuplexLoopback();
 *   createStdioMcpServer({ agent, manifest, input: serverEnd, output: serverEnd, dispatch });
 *   // client writes JSON-RPC lines to clientEnd.write, reads replies via clientEnd.onData
 *
 * @returns {{ a:{onData:Function,write:Function}, b:{onData:Function,write:Function} }}
 */
export function createDuplexLoopback() {
  const aListeners = [];
  const bListeners = [];
  const deliver = (listeners, str) => { for (const cb of listeners.slice()) cb(str); };
  const a = {
    onData: (cb) => { aListeners.push(cb); },
    write:  (str) => { deliver(bListeners, str); }, // a → b
  };
  const b = {
    onData: (cb) => { bListeners.push(cb); },
    write:  (str) => { deliver(aListeners, str); }, // b → a
  };
  return { a, b };
}

/**
 * A tiny NDJSON JSON-RPC CLIENT over a stream endpoint, for tests. Correlates
 * replies to requests by `id` and resolves the matching promise. This is the
 * counterpart a real MCP client would run; here it drives the loopback.
 *
 * @param {{ onData:(cb:(chunk:string)=>void)=>void, write:(str:string)=>void }} stream
 */
export function createStdioTestClient(stream) {
  const pending = new Map();
  let seq = 0;

  const decoder = createNdjsonDecoder({
    onMessage: (msg) => {
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const resolve = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    },
    onError: () => { /* client ignores malformed server lines in these tests */ },
  });
  stream.onData((chunk) => decoder.push(chunk));

  return {
    /** Send a request and resolve with the correlated reply message. */
    request(method, params) {
      const id = ++seq;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        stream.write(encodeLine(jsonRpcRequest(id, method, params)));
      });
    },
    /** Send a fire-and-forget notification (no reply). */
    notify(method, params) {
      stream.write(encodeLine(jsonRpcNotification(method, params)));
    },
    /** Write a raw string (for malformed-line / framing tests). */
    sendRaw(str) { stream.write(str); },
  };
}

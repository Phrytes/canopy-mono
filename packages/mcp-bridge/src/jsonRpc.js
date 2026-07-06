/**
 * jsonRpc.js — JSON-RPC 2.0 message shapes + NDJSON (newline-delimited) codec.
 *
 * MCP over stdio is newline-delimited JSON-RPC 2.0 on a duplex byte stream. This
 * module models the JSON-RPC layer as plain objects (per the repo's hermetic
 * convention — NO real `@modelcontextprotocol/*` SDK, consistent with
 * `mcpShapes.js`) and provides the line codec a real stdio server would use:
 *
 *   • builders for request / notification / success-response / error-response
 *   • `encodeLine(msg)`  → `JSON.stringify(msg) + "\n"`  (one NDJSON line)
 *   • `createNdjsonDecoder({onMessage,onError})` — a line-buffering decoder that
 *     turns an incoming CHUNK stream into parsed messages. It handles partial
 *     lines (a message split across chunks), multiple messages per chunk, and a
 *     trailing newline. A malformed JSON line is surfaced via `onError` (a
 *     JSON-RPC parse error) rather than throwing — a bad line must not crash the
 *     stream.
 *
 * Error-code policy (see the MCP lifecycle in mcpSession.js):
 *   • PROTOCOL-level failures (malformed line, unknown METHOD, request before
 *     initialize) → a JSON-RPC `error` object with a standard code.
 *   • TOOL-level failures (gate deny, unknown TOOL, skill throw) keep the MCP
 *     `{ isError:true }` tool-result semantics and travel inside a JSON-RPC
 *     SUCCESS `result` — they are not JSON-RPC transport errors.
 */

export const JSONRPC_VERSION = '2.0';

/** Standard JSON-RPC 2.0 error codes (+ a server-error slot). */
export const JsonRpcErrorCode = {
  ParseError:     -32700, // invalid JSON received
  InvalidRequest: -32600, // not a valid Request object
  MethodNotFound: -32601, // method does not exist / is not available
  InvalidParams:  -32602, // invalid method parameters
  InternalError:  -32603, // internal JSON-RPC error
  ServerError:    -32000, // implementation-defined server error (e.g. pre-initialize call)
};

/** A JSON-RPC 2.0 request: `{ jsonrpc, id, method, params? }`. */
export function jsonRpcRequest(id, method, params) {
  const msg = { jsonrpc: JSONRPC_VERSION, id, method };
  if (params !== undefined) msg.params = params;
  return msg;
}

/** A JSON-RPC 2.0 notification: a request with NO `id` (no reply expected). */
export function jsonRpcNotification(method, params) {
  const msg = { jsonrpc: JSONRPC_VERSION, method };
  if (params !== undefined) msg.params = params;
  return msg;
}

/** A JSON-RPC 2.0 success response: `{ jsonrpc, id, result }`. */
export function jsonRpcResult(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id: id ?? null, result };
}

/** A JSON-RPC 2.0 error response: `{ jsonrpc, id, error:{ code, message, data? } }`. */
export function jsonRpcError(id, code, message, data) {
  const error = { code, message: String(message ?? 'error') };
  if (data !== undefined) error.data = data;
  return { jsonrpc: JSONRPC_VERSION, id: id ?? null, error };
}

/** True for a JSON-RPC notification (a message with a method and no `id`). */
export function isNotification(msg) {
  return !!msg && typeof msg.method === 'string' && msg.id === undefined;
}

/** True for a JSON-RPC request (method + an `id`). */
export function isRequest(msg) {
  return !!msg && typeof msg.method === 'string' && msg.id !== undefined;
}

/** True for a JSON-RPC response (has `result` or `error`, no `method`). */
export function isResponse(msg) {
  return !!msg && msg.method === undefined && ('result' in msg || 'error' in msg);
}

/** Serialize a message to a single NDJSON line (`JSON.stringify(msg) + "\n"`). */
export function encodeLine(msg) {
  return JSON.stringify(msg) + '\n';
}

/**
 * A stateful line-buffering NDJSON decoder.
 *
 * Feed it raw string chunks via `push(chunk)`; each complete `\n`-terminated
 * line is JSON-parsed and dispatched to `onMessage(msg)`. A partial line is held
 * in an internal buffer until its newline arrives (so a message split across two
 * chunks is reassembled). Multiple messages in one chunk are all emitted, in
 * order. Blank lines are ignored. A line that is not valid JSON is reported to
 * `onError({ line, error })` — the decoder never throws on bad input.
 *
 * `flush()` parses any buffered trailing content that had no terminating newline
 * (useful at stream end); normally callers rely on newline-terminated lines.
 *
 * @param {object} p
 * @param {(msg:object)=>void} [p.onMessage]
 * @param {(info:{line:string,error:Error})=>void} [p.onError]
 * @returns {{ push:(chunk:string)=>void, flush:()=>void }}
 */
export function createNdjsonDecoder({ onMessage, onError } = {}) {
  let buffer = '';

  function handleLine(line) {
    const trimmed = line.trim();
    if (trimmed === '') return; // ignore blank / whitespace-only lines
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (error) {
      onError?.({ line, error });
      return;
    }
    onMessage?.(msg);
  }

  return {
    push(chunk) {
      buffer += chunk == null ? '' : String(chunk);
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        handleLine(line);
      }
    },
    flush() {
      if (buffer.length > 0) {
        const line = buffer;
        buffer = '';
        handleLine(line);
      }
    },
  };
}

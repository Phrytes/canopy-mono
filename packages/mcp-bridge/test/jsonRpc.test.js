/**
 * jsonRpc.test.js — the JSON-RPC 2.0 / NDJSON codec.
 *
 * Round-trips request/response/notification; proves the line-buffering decoder
 * handles split chunks, multiple-messages-per-chunk, and a partial trailing
 * line; and that a malformed JSON line surfaces a parse error (not a crash).
 */
import { describe, it, expect } from 'vitest';
import {
  JSONRPC_VERSION, JsonRpcErrorCode,
  jsonRpcRequest, jsonRpcNotification, jsonRpcResult, jsonRpcError,
  isRequest, isNotification, isResponse,
  encodeLine, createNdjsonDecoder,
} from '../src/index.js';

describe('jsonRpc — message builders + classifiers', () => {
  it('request has jsonrpc/id/method/params and classifies as a request', () => {
    const req = jsonRpcRequest(1, 'tools/list', { a: 1 });
    expect(req).toEqual({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { a: 1 } });
    expect(isRequest(req)).toBe(true);
    expect(isNotification(req)).toBe(false);
    expect(isResponse(req)).toBe(false);
  });

  it('a request with no params omits the params key', () => {
    expect(jsonRpcRequest(2, 'ping')).toEqual({ jsonrpc: '2.0', id: 2, method: 'ping' });
  });

  it('notification has NO id and classifies as a notification', () => {
    const note = jsonRpcNotification('notifications/initialized');
    expect(note).toEqual({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect('id' in note).toBe(false);
    expect(isNotification(note)).toBe(true);
    expect(isRequest(note)).toBe(false);
  });

  it('success response carries a result; error response carries an error object', () => {
    const ok  = jsonRpcResult(3, { tools: [] });
    const err = jsonRpcError(4, JsonRpcErrorCode.MethodNotFound, 'Method not found: x');
    expect(ok).toEqual({ jsonrpc: '2.0', id: 3, result: { tools: [] } });
    expect(err).toEqual({ jsonrpc: '2.0', id: 4, error: { code: -32601, message: 'Method not found: x' } });
    expect(isResponse(ok)).toBe(true);
    expect(isResponse(err)).toBe(true);
    expect(JSONRPC_VERSION).toBe('2.0');
  });

  it('error response defaults a missing id to null (parse-error case)', () => {
    expect(jsonRpcError(undefined, JsonRpcErrorCode.ParseError, 'Parse error').id).toBe(null);
  });
});

describe('jsonRpc — NDJSON encode/decode round-trip', () => {
  it('encodeLine → decode yields the same message', () => {
    const seen = [];
    const dec = createNdjsonDecoder({ onMessage: (m) => seen.push(m) });
    const messages = [
      jsonRpcRequest(1, 'initialize', { protocolVersion: '2025-06-18' }),
      jsonRpcResult(1, { ok: true }),
      jsonRpcNotification('notifications/initialized'),
    ];
    for (const m of messages) dec.push(encodeLine(m));
    expect(seen).toEqual(messages);
  });
});

describe('jsonRpc — NDJSON decoder chunk handling', () => {
  it('reassembles a message split across chunks', () => {
    const seen = [];
    const dec = createNdjsonDecoder({ onMessage: (m) => seen.push(m) });
    const line = encodeLine(jsonRpcRequest(7, 'tools/list'));
    const mid = Math.floor(line.length / 2);
    dec.push(line.slice(0, mid));
    expect(seen).toHaveLength(0);        // no newline seen yet → nothing emitted
    dec.push(line.slice(mid));
    expect(seen).toEqual([{ jsonrpc: '2.0', id: 7, method: 'tools/list' }]);
  });

  it('emits multiple messages delivered in one chunk, in order', () => {
    const seen = [];
    const dec = createNdjsonDecoder({ onMessage: (m) => seen.push(m) });
    const chunk =
      encodeLine(jsonRpcRequest(1, 'a')) +
      encodeLine(jsonRpcRequest(2, 'b')) +
      encodeLine(jsonRpcRequest(3, 'c'));
    dec.push(chunk);
    expect(seen.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('holds a partial trailing line until its newline arrives', () => {
    const seen = [];
    const dec = createNdjsonDecoder({ onMessage: (m) => seen.push(m) });
    // one whole line + the start of a second
    dec.push(encodeLine(jsonRpcRequest(1, 'a')) + '{"jsonrpc":"2.0","id":2,');
    expect(seen.map((m) => m.id)).toEqual([1]);       // only the complete line emitted
    dec.push('"method":"b"}\n');
    expect(seen.map((m) => m.id)).toEqual([1, 2]);    // trailing line completed
  });

  it('flush() parses a buffered line with no terminating newline', () => {
    const seen = [];
    const dec = createNdjsonDecoder({ onMessage: (m) => seen.push(m) });
    dec.push('{"jsonrpc":"2.0","id":9,"method":"ping"}'); // no \n
    expect(seen).toHaveLength(0);
    dec.flush();
    expect(seen).toEqual([{ jsonrpc: '2.0', id: 9, method: 'ping' }]);
  });

  it('ignores blank lines between messages', () => {
    const seen = [];
    const dec = createNdjsonDecoder({ onMessage: (m) => seen.push(m) });
    dec.push('\n\n' + encodeLine(jsonRpcRequest(1, 'a')) + '\n\n');
    expect(seen.map((m) => m.id)).toEqual([1]);
  });
});

describe('jsonRpc — malformed input is a parse error, not a crash', () => {
  it('a non-JSON line goes to onError and does NOT throw or emit a message', () => {
    const seen = [];
    const errs = [];
    const dec = createNdjsonDecoder({ onMessage: (m) => seen.push(m), onError: (e) => errs.push(e) });
    expect(() => dec.push('this is not json\n')).not.toThrow();
    expect(seen).toHaveLength(0);
    expect(errs).toHaveLength(1);
    expect(errs[0].line).toBe('this is not json');
    expect(errs[0].error).toBeInstanceOf(Error);
  });

  it('a bad line between two good lines does not lose the good ones', () => {
    const seen = [];
    const errs = [];
    const dec = createNdjsonDecoder({ onMessage: (m) => seen.push(m), onError: (e) => errs.push(e) });
    dec.push(encodeLine(jsonRpcRequest(1, 'a')) + '{bad\n' + encodeLine(jsonRpcRequest(2, 'b')));
    expect(seen.map((m) => m.id)).toEqual([1, 2]);
    expect(errs).toHaveLength(1);
  });
});

/**
 * NetworkTransport.test.js — focused unit tests for the transport itself.
 *
 * Envelope/frame round-trip, request/response correlation over a mock loopback
 * channel, error framing and the fetch/HTTP serve-timeout. No agent, no crypto,
 * no real socket — the injected `send` channel is a plain in-memory function.
 *
 * (The end-to-end #63 remote-handler flow across the boundary — with the
 * capability gate — is proven in @canopy/secure-agent/test/remoteHandlersNetwork.test.js.)
 */
import { describe, it, expect, vi } from 'vitest';
import { Transport } from '@canopy/core';
import {
  NetworkTransport,
  createNetworkTransport,
  handleNetworkRequest,
  encodeFrame,
  decodeFrame,
} from '../src/index.js';

describe('NetworkTransport — construction + port shape', () => {
  it('is the SAME Transport base from @canopy/core (no parallel port)', () => {
    expect(Object.getPrototypeOf(NetworkTransport.prototype)).toBe(Transport.prototype);
  });

  it('requires an address/identity and a send channel', () => {
    expect(() => new NetworkTransport({ send: () => {} })).toThrow(/identity or address/);
    expect(() => new NetworkTransport({ address: 'A' })).toThrow(/send/);
    expect(createNetworkTransport({ address: 'A', send: () => {} }).address).toBe('A');
  });
});

describe('frame codec — round-trip + safety', () => {
  it('encodes to a JSON string and decodes back losslessly', () => {
    const envelope = { _id: 'e1', _p: 'RQ', _from: 'A', _to: 'B', payload: { _box: 'ciphertext' } };
    const str = encodeFrame({ to: 'B', from: 'A', envelope });
    expect(typeof str).toBe('string');
    const { to, from, envelope: rt } = decodeFrame(str);
    expect(to).toBe('B');
    expect(from).toBe('A');
    expect(rt).toEqual(envelope);
  });

  it('strips the live `_transport` back-ref so nothing non-serializable leaks', () => {
    const circular = { self: null }; circular.self = circular;   // would throw JSON.stringify
    const envelope = { _id: 'e1', payload: { _box: 'x' }, _transport: circular };
    const str = encodeFrame({ to: 'B', from: 'A', envelope });   // must NOT throw
    expect(decodeFrame(str).envelope._transport).toBeUndefined();
  });

  it('rejects a malformed frame', () => {
    expect(() => decodeFrame('{"kind":"nope"}')).toThrow(/malformed/);
    expect(() => decodeFrame({ kind: 'a2a' })).toThrow(/malformed/);
  });
});

describe('outbound _put → injected send channel', () => {
  it('hands the encoded frame to send()', async () => {
    const send = vi.fn();
    const t = createNetworkTransport({ address: 'A', send });
    await t._put('B', { _id: 'e1', _p: 'OW', payload: { _box: 'x' } });
    expect(send).toHaveBeenCalledOnce();
    const { to, from, envelope } = decodeFrame(send.mock.calls[0][0]);
    expect(to).toBe('B');
    expect(from).toBe('A');
    expect(envelope._id).toBe('e1');
  });
});

describe('request/response correlation over a mock loopback (no crypto)', () => {
  /**
   * Wire two bare transports (no SecurityLayer) into a bidirectional loopback:
   * each side's send() delivers to the other's receiveFrame(). A minimal
   * "server" on B answers every RQ with an RS via the base-class respond().
   */
  function loopback() {
    let A, B;
    A = new NetworkTransport({ address: 'A', send: (f) => queueMicrotask(() => B.receiveFrame(f)) });
    B = new NetworkTransport({ address: 'B', send: (f) => queueMicrotask(() => A.receiveFrame(f)) });
    return { A, B };
  }

  it('resolves request() when the peer responds (matching _id ⇄ _re)', async () => {
    const { A, B } = loopback();
    B.setReceiveHandler((env) => {
      // Echo server: reply to the RQ with its own payload.
      B.respond(env._from, env._id, { echoed: env.payload });
    });
    const rs = await A.request('B', { hello: 'world' }, 1_000);
    expect(rs.payload).toEqual({ echoed: { hello: 'world' } });
  });

  it('propagates a remote error as the response payload (error framing)', async () => {
    const { A, B } = loopback();
    B.setReceiveHandler((env) => {
      B.respond(env._from, env._id, { status: 'failed', error: 'boom' });
    });
    const rs = await A.request('B', { do: 'x' }, 1_000);
    expect(rs.payload).toEqual({ status: 'failed', error: 'boom' });
  });

  it('times out when the peer never answers', async () => {
    const A = new NetworkTransport({ address: 'A', send: () => {} });  // black hole
    await expect(A.request('B', { x: 1 }, 30)).rejects.toThrow(/Timeout/);
  });
});

describe('multi-frame streaming exchange over a bidirectional loopback', () => {
  /**
   * A streaming skill produces, for ONE request id, N `stream-chunk` OW frames
   * (fresh `_id`, no `_re`) followed by the terminal `task-result` RS (`_re` =
   * the RQ `_id`) — the SAME frames the in-process `callSkill` streaming path
   * carries (see @canopy/core taskExchange `_runStreamingHandler`). This proves
   * the frame-agnostic NetworkTransport carries that exchange unchanged over the
   * push channel: chunks route to the caller's receiveHandler, the terminal RS
   * resolves the pending request. (The pure request→response `handleNetworkRequest`
   * fetch seam CANNOT carry this — there is no back-channel for the OW chunks.)
   */
  function loopback() {
    let A, B;
    A = new NetworkTransport({ address: 'A', send: (f) => queueMicrotask(() => B.receiveFrame(f)) });
    B = new NetworkTransport({ address: 'B', send: (f) => queueMicrotask(() => A.receiveFrame(f)) });
    return { A, B };
  }

  it('carries N stream-chunk OWs + a terminal RS for ONE request id, in order', async () => {
    const { A, B } = loopback();

    // B is a streaming "skill": on an RQ it emits 3 stream-chunk OWs correlated
    // to the request's taskId, then the terminal task-result RS.
    B.setReceiveHandler(async (env) => {
      const { taskId } = env.payload;
      for (const n of [1, 2, 3]) {
        await B.sendOneWay(env._from, { type: 'stream-chunk', taskId, parts: [{ text: `chunk-${n}` }] });
      }
      await B.respond(env._from, env._id, { type: 'task-result', taskId, status: 'completed', parts: [] });
    });

    // A collects inbound stream-chunk OWs; request() resolves on the terminal RS
    // (the RS is correlated by _re and is NOT delivered to the receiveHandler).
    const chunks = [];
    A.setReceiveHandler((env) => {
      if (env.payload?.type === 'stream-chunk') chunks.push(env.payload.parts[0].text);
    });

    const rs = await A.request('B', { type: 'task', taskId: 't1', skillId: 'stream' }, 1_000);
    expect(rs.payload.status).toBe('completed');
    expect(rs.payload.taskId).toBe('t1');
    expect(chunks).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);  // all chunks arrived, in order
  });

  it('interleaved streams on the same channel stay correlated by taskId', async () => {
    const { A, B } = loopback();
    B.setReceiveHandler(async (env) => {
      const { taskId, skillId } = env.payload;
      // Emit taskId-tagged chunks so the caller can demux two concurrent streams.
      for (const n of [1, 2]) {
        await B.sendOneWay(env._from, { type: 'stream-chunk', taskId, parts: [{ text: `${skillId}:${n}` }] });
      }
      await B.respond(env._from, env._id, { type: 'task-result', taskId, status: 'completed', parts: [] });
    });

    const byTask = new Map();
    A.setReceiveHandler((env) => {
      if (env.payload?.type !== 'stream-chunk') return;
      const list = byTask.get(env.payload.taskId) ?? [];
      list.push(env.payload.parts[0].text);
      byTask.set(env.payload.taskId, list);
    });

    const [r1, r2] = await Promise.all([
      A.request('B', { type: 'task', taskId: 'ta', skillId: 'x' }, 1_000),
      A.request('B', { type: 'task', taskId: 'tb', skillId: 'y' }, 1_000),
    ]);
    expect(r1.payload.taskId).toBe('ta');
    expect(r2.payload.taskId).toBe('tb');
    expect(byTask.get('ta')).toEqual(['x:1', 'x:2']);
    expect(byTask.get('tb')).toEqual(['y:1', 'y:2']);
  });
});

describe('fetch/HTTP serve mode — handleNetworkRequest', () => {
  it('drives an inbound RQ and returns the correlated RS frame (no push channel)', async () => {
    // B is a fetch-style server: its send() must NEVER be called (the RS comes
    // back as the return value, not a fresh push).
    const bSend = vi.fn();
    const B = new NetworkTransport({ address: 'B', send: bSend });
    B.setReceiveHandler((env) => B.respond(env._from, env._id, { ok: env.payload }));

    // A is the client: its send() = POST the frame to B's handler, feed the
    // returned RS frame back into A.
    const A = new NetworkTransport({
      address: 'A',
      send: async (frame) => {
        const respFrame = await handleNetworkRequest(B, frame);
        A.receiveFrame(respFrame);
      },
    });

    const rs = await A.request('B', { n: 42 }, 1_000);
    expect(rs.payload).toEqual({ ok: { n: 42 } });
    expect(bSend).not.toHaveBeenCalled();   // pure request/response, no back-channel
  });

  it('rejects on serve timeout when the handler never responds', async () => {
    const B = new NetworkTransport({ address: 'B', send: () => {} });
    B.setReceiveHandler(() => { /* never respond */ });
    const frame = encodeFrame({ to: 'B', from: 'A', envelope: { _id: 'r1', _p: 'RQ', payload: {} } });
    await expect(handleNetworkRequest(B, frame, { timeout: 30 })).rejects.toThrow(/no response/);
  });

  it('rejects a non-NetworkTransport', () => {
    expect(() => handleNetworkRequest({}, '{}')).toThrow(/NetworkTransport/);
  });
});

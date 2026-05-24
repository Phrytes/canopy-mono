/**
 * NknTransport (React Native) unit tests — nkn lib + network are fully
 * mocked.  No real NKN traffic is generated in CI.
 *
 * The integration test at the bottom (real mainnet round-trip) is
 * gated behind `RUN_NKN_TESTS=1`, mirroring
 * `apps/canopy-chat/test-browser/mesh-and-dm.spec.js`'s flake-management.
 *
 * To run the live-network test locally:
 *     RUN_NKN_TESTS=1 pnpm exec vitest run test/transport/NknTransport.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AgentIdentity, VaultMemory } from '@canopy/core';
import { NknTransport, HI_RACE_PATTERNS } from '../../src/transport/NknTransport.js';

const RUN_INTEGRATION = !!process.env.RUN_NKN_TESTS;

// ── Mock factory ──────────────────────────────────────────────────────────────

/**
 * Build a fake nkn-sdk-shaped library object.  The transport calls
 *   new nknLib.MultiClient(opts)  or  new nknLib.Client(opts)
 * and then uses .on('connect'|'message'|'error', fn), .send(addr, json, opts),
 * .close(), and .addr.
 *
 * Returns the library + a handle to the most-recently-constructed
 * client so tests can drive its events.
 */
function makeFakeNkn({ autoConnect = true, addr = 'nkn-self-addr' } = {}) {
  const handle = { current: null };

  class FakeClient {
    constructor(opts) {
      this.opts      = opts;
      this.addr      = addr;
      this._handlers = new Map();
      this.sentMessages = [];
      this.sendImpl  = vi.fn(async (_to, _payload, _opts) => undefined);
      this.closed    = false;
      handle.current = this;

      if (autoConnect) {
        // Defer 'connect' to next microtask so the transport's `on()`
        // wiring has time to land before the event fires.
        queueMicrotask(() => this._emit('connect'));
      }
    }
    on(event, fn) {
      if (!this._handlers.has(event)) this._handlers.set(event, new Set());
      this._handlers.get(event).add(fn);
      return this;
    }
    _emit(event, payload) {
      for (const fn of [...(this._handlers.get(event) ?? [])]) fn(payload);
    }
    async send(to, payload, opts) {
      this.sentMessages.push({ to, payload, opts });
      return this.sendImpl(to, payload, opts);
    }
    close() { this.closed = true; }
  }

  return {
    lib: {
      Client:      FakeClient,
      MultiClient: FakeClient,
    },
    handle,
  };
}

/** Wait for the underlying NKN client emit('connect') to land. */
const flushMicrotasks = () => new Promise((r) => setImmediate(r));

// ── Construction ──────────────────────────────────────────────────────────────

describe('NknTransport construction', () => {
  it('throws without identity', () => {
    expect(() => new NknTransport({})).toThrow(/identity/);
  });

  it('constructs without throwing when identity is provided', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    expect(() => new NknTransport({ identity: id })).not.toThrow();
  });

  it('reports not-connected before connect()', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const t  = new NknTransport({ identity: id, nknLib: makeFakeNkn().lib });
    expect(t.connected).toBe(false);
    expect(t.canReach('anyone')).toBe(false);
  });
});

// ── connect() ─────────────────────────────────────────────────────────────────

describe('NknTransport connect', () => {
  let identity;
  beforeEach(async () => { identity = await AgentIdentity.generate(new VaultMemory()); });

  it('boots the underlying client + sets address from client.addr', async () => {
    const { lib, handle } = makeFakeNkn({ addr: 'nkn-test-addr' });
    const t = new NknTransport({ identity, nknLib: lib });
    await t.connect();
    expect(t.connected).toBe(true);
    expect(t.address).toBe('nkn-test-addr');
    expect(handle.current).not.toBeNull();
  });

  it('prefers MultiClient when both MultiClient and Client are exported', async () => {
    let lastCtor = null;
    class FakeMC { constructor() { lastCtor = 'MultiClient'; this.addr = 'mc'; this.on = (e, fn) => (e === 'connect' && queueMicrotask(fn)); this.close = () => {}; } }
    class FakeC  { constructor() { lastCtor = 'Client';      this.addr = 'c';  this.on = (e, fn) => (e === 'connect' && queueMicrotask(fn)); this.close = () => {}; } }
    const t = new NknTransport({
      identity,
      nknLib: { MultiClient: FakeMC, Client: FakeC },
    });
    await t.connect();
    expect(lastCtor).toBe('MultiClient');
  });

  it('falls back to Client when MultiClient is missing', async () => {
    let lastCtor = null;
    class FakeC { constructor() { lastCtor = 'Client'; this.addr = 'c'; this.on = (e, fn) => (e === 'connect' && queueMicrotask(fn)); this.close = () => {}; } }
    const t = new NknTransport({
      identity,
      nknLib: { Client: FakeC },
    });
    await t.connect();
    expect(lastCtor).toBe('Client');
  });

  it('rejects when neither MultiClient nor Client is exported', async () => {
    const t = new NknTransport({
      identity,
      nknLib: { /* empty lib */ },
    });
    await expect(t.connect()).rejects.toThrow(/MultiClient|Client/);
  });

  it('canReach reports true only after connect resolves', async () => {
    const { lib } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib });
    expect(t.canReach('peer')).toBe(false);
    await t.connect();
    expect(t.canReach('peer')).toBe(true);
  });
});

// ── disconnect() ──────────────────────────────────────────────────────────────

describe('NknTransport disconnect', () => {
  it('closes the client and clears address + helloed-peer set', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib });
    await t.connect();
    await t.sendHelloOnce('peer-A');
    expect(handle.current.closed).toBe(false);
    await t.disconnect();
    expect(handle.current.closed).toBe(true);
    expect(t.connected).toBe(false);
    expect(t.address).toBe(null);
  });
});

// ── HI handshake sequence ────────────────────────────────────────────────────

describe('NknTransport HI handshake', () => {
  let identity;
  beforeEach(async () => { identity = await AgentIdentity.generate(new VaultMemory()); });

  it('sendHelloOnce: sends HI exactly once even with concurrent callers', async () => {
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib });
    await t.connect();

    // Two parallel callers → ONE HI on the wire.
    await Promise.all([t.sendHelloOnce('peer-X'), t.sendHelloOnce('peer-X')]);

    const hiSends = handle.current.sentMessages.filter((m) => {
      try { return JSON.parse(m.payload)._p === 'HI'; } catch { return false; }
    });
    expect(hiSends).toHaveLength(1);
    expect(hiSends[0].to).toBe('peer-X');
  });

  it('HI race fix: helloedPeers is mutated AFTER sendHello resolves (issue #215)', async () => {
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib });
    await t.connect();

    // Make send() pause so we can observe the in-flight state.
    let releaseSend;
    handle.current.sendImpl = vi.fn(() => new Promise((res) => { releaseSend = res; }));

    const helloPromise = t.sendHelloOnce('peer-Y');

    // While the HI send is in-flight, a SECOND caller must wait — they
    // must NOT see helloedPeers as already-set, otherwise the
    // concurrent _put() would skip HI and the receiver would drop the
    // OW envelope (this is the bilateral HI race fix from #215).
    let secondResolved = false;
    const secondHello  = t.sendHelloOnce('peer-Y').then(() => { secondResolved = true; });
    // Yield several microtasks; secondHello should still be pending.
    await Promise.resolve(); await Promise.resolve();
    expect(secondResolved).toBe(false);

    // Now release the send + let both resolve.
    releaseSend();
    await helloPromise;
    await secondHello;

    // Only ONE send call total — second caller joined the in-flight HI.
    expect(handle.current.sentMessages).toHaveLength(1);
  });

  it('_put auto-sends HI before the first OW to a new peer', async () => {
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib });
    await t.connect();

    await t._put('peer-Z', { _p: 'OW', _from: 'me', _to: 'peer-Z', payload: { hi: 'there' } });

    expect(handle.current.sentMessages).toHaveLength(2);
    const [first, second] = handle.current.sentMessages.map((m) => JSON.parse(m.payload));
    expect(first._p).toBe('HI');
    expect(second._p).toBe('OW');
  });

  it('_put does NOT auto-HI when the envelope itself is a HI', async () => {
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib });
    await t.connect();

    await t._put('peer-W', { _p: 'HI', _from: 'me', _to: 'peer-W', payload: {} });

    // Only the one HI we asked for; no recursion.
    expect(handle.current.sentMessages).toHaveLength(1);
    expect(JSON.parse(handle.current.sentMessages[0].payload)._p).toBe('HI');
  });
});

// ── send-with-retry on HI-race failure ────────────────────────────────────────

describe('NknTransport send-with-retry', () => {
  let identity;
  beforeEach(async () => { identity = await AgentIdentity.generate(new VaultMemory()); });

  it('retries OW after server says "no pubKey registered" (re-HI + re-send)', async () => {
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib, sendRetryDelayMs: 0 });
    await t.connect();

    // First OW (call #2 — call #1 is the auto-HI) fails with the
    // canonical HI-race error.  Second OW succeeds.
    let owAttempts = 0;
    handle.current.sendImpl = vi.fn(async (_to, payload) => {
      const env = JSON.parse(payload);
      if (env._p !== 'OW') return undefined;          // HI sends succeed
      owAttempts++;
      if (owAttempts === 1) throw new Error('NKN: no pubKey registered for this address');
      return undefined;                                // retry succeeds
    });

    await t._put('peer-R', { _p: 'OW', _from: 'me', _to: 'peer-R', payload: { x: 1 } });

    // Pattern on the wire: HI, OW(fail), HI(re-issued), OW(succeed)
    const kinds = handle.current.sentMessages.map((m) => JSON.parse(m.payload)._p);
    expect(kinds).toEqual(['HI', 'OW', 'HI', 'OW']);
  });

  it('retries on "send HI first" error', async () => {
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib, sendRetryDelayMs: 0 });
    await t.connect();

    let owAttempts = 0;
    handle.current.sendImpl = vi.fn(async (_to, payload) => {
      const env = JSON.parse(payload);
      if (env._p !== 'OW') return undefined;
      owAttempts++;
      if (owAttempts === 1) throw new Error('please send HI first to that address');
    });

    await t._put('peer-R', { _p: 'OW', _from: 'me', _to: 'peer-R', payload: {} });
    expect(owAttempts).toBe(2);
  });

  it('retries on "did not respond with HI" error', async () => {
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib, sendRetryDelayMs: 0 });
    await t.connect();

    let owAttempts = 0;
    handle.current.sendImpl = vi.fn(async (_to, payload) => {
      const env = JSON.parse(payload);
      if (env._p !== 'OW') return undefined;
      owAttempts++;
      if (owAttempts === 1) throw new Error('peer did not respond with HI');
    });

    await t._put('peer-R', { _p: 'OW', _from: 'me', _to: 'peer-R', payload: {} });
    expect(owAttempts).toBe(2);
  });

  it('does NOT retry on non-HI-race errors — propagates immediately', async () => {
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib, sendRetryDelayMs: 0 });
    await t.connect();

    let owAttempts = 0;
    handle.current.sendImpl = vi.fn(async (_to, payload) => {
      const env = JSON.parse(payload);
      if (env._p !== 'OW') return undefined;
      owAttempts++;
      throw new Error('network unreachable');
    });

    await expect(
      t._put('peer-R', { _p: 'OW', _from: 'me', _to: 'peer-R', payload: {} }),
    ).rejects.toThrow(/network unreachable/);
    expect(owAttempts).toBe(1);             // no retry attempted
  });

  it('gives up after `sendRetries` HI-race attempts and maps to a clear error', async () => {
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib, sendRetries: 2, sendRetryDelayMs: 0 });
    await t.connect();

    let owAttempts = 0;
    handle.current.sendImpl = vi.fn(async (_to, payload) => {
      const env = JSON.parse(payload);
      if (env._p !== 'OW') return undefined;
      owAttempts++;
      throw new Error('no pubKey registered');
    });

    await expect(
      t._put('peer-R', { _p: 'OW', _from: 'me', _to: 'peer-R', payload: {} }),
    ).rejects.toThrow(/failed after 3 attempts/);
    expect(owAttempts).toBe(3);             // initial + 2 retries
  });
});

// ── HI_RACE_PATTERNS export ──────────────────────────────────────────────────

describe('HI_RACE_PATTERNS', () => {
  it('matches the canonical NKN server-side error strings', () => {
    const match = (s) => HI_RACE_PATTERNS.some((re) => re.test(s));
    expect(match('no pubKey registered for that address')).toBe(true);
    expect(match('NKN: no pubkey registered')).toBe(true);
    expect(match('please send HI first')).toBe(true);
    expect(match('peer did not respond with HI yet')).toBe(true);
    expect(match('connection reset')).toBe(false);
    expect(match('timeout')).toBe(false);
  });
});

// ── forgetPeer ───────────────────────────────────────────────────────────────

describe('NknTransport forgetPeer', () => {
  it('drops cached helloed-peer state so the next send re-HIs', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib });
    await t.connect();

    await t.sendHelloOnce('peer-F');
    expect(handle.current.sentMessages).toHaveLength(1);

    t.forgetPeer('peer-F');
    await t.sendHelloOnce('peer-F');
    expect(handle.current.sentMessages).toHaveLength(2);    // HI fired again
  });
});

// ── Inbound receive ──────────────────────────────────────────────────────────

describe('NknTransport receive', () => {
  it('decodes payload via JSON.parse + delegates to _receive', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib });
    await t.connect();

    const inbound = new Promise((res) => t.setReceiveHandler(res));
    handle.current._emit('message', {
      payload: JSON.stringify({
        _v: 1, _p: 'OW', _id: 'env-1', _re: null,
        _from: 'peer-A', _to: t.address, _topic: null,
        _ts: Date.now(), _sig: null, payload: { kind: 'ping' },
      }),
    });

    const env = await inbound;
    expect(env.payload.kind).toBe('ping');
    expect(env._from).toBe('peer-A');
  });

  it('drops malformed inbound payloads without throwing', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const { lib, handle } = makeFakeNkn();
    const t = new NknTransport({ identity, nknLib: lib });
    await t.connect();

    const calls = [];
    t.setReceiveHandler((e) => calls.push(e));
    handle.current._emit('message', { payload: '<<not json>>' });
    // Yield + ensure nothing landed.
    await flushMicrotasks();
    expect(calls).toHaveLength(0);
  });
});

// ── Live-network integration (skipped unless RUN_NKN_TESTS=1) ────────────────

describe.skipIf(!RUN_INTEGRATION)('NknTransport integration (requires real NKN network)', () => {
  it('connects to NKN mainnet and round-trips a HI + OW', async () => {
    // Real nkn-sdk is dynamically imported by the transport when no
    // nknLib is passed.  Must be installed under packages/react-native
    // (or hoisted in the monorepo) for this test to run.
    const id = await AgentIdentity.generate(new VaultMemory());
    const a  = new NknTransport({ identity: id, identifier: 'rn-test-a' });
    const b  = new NknTransport({ identity: id, identifier: 'rn-test-b' });

    await Promise.all([a.connect(), b.connect()]);

    const received = new Promise((res) => b.setReceiveHandler(res));
    await a._put(b.address, {
      _v: 1, _p: 'OW', _id: 'rn-test', _re: null,
      _from: a.address, _to: b.address, _topic: null,
      _ts: Date.now(), _sig: null, payload: { type: 'rn-ping' },
    });

    const env = await received;
    expect(env.payload.type).toBe('rn-ping');

    await a.disconnect();
    await b.disconnect();
  }, 120_000);
});

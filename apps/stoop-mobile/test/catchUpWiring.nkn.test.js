/**
 * catchUpWiring.nkn — Option A wiring (#248, 2026-05-27).
 *
 * Covers the additions in:
 *   - apps/stoop-mobile/src/lib/agentBundle.js     buildMeshAgent NKN composition
 *   - apps/stoop-mobile/src/lib/catchUpWiring.js   real scheduleCatchUp + peer router
 *
 * Real-network limit: the NKN mainnet handshake (5–90s, real keys,
 * real DHT) is NOT exercised here.  Same convention as #265's pod-
 * creds skip — those go behind a real-device Detox slice
 * (#224B/#265.real-net).  We mock `nknLib` so the transport
 * constructs deterministically and we can poke its receive seam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { buildMeshAgent } from '../src/lib/agentBundle.js';
import { wireCatchUp }    from '../src/lib/catchUpWiring.js';
import nacl               from 'tweetnacl';

// Same shape as canopy-chat-mobile/test/bootSmoke.test.js — the only
// surface NknTransport needs at construct-time is `MultiClient` or
// `Client`.  The mock's `on('connect')` is what tells the transport
// it's live; we drive it manually to exercise the connect handler.
function makeFakeNknLib() {
  /** Per-instance listener registry so the test can drive 'connect'/'message'. */
  const instances = [];
  class MultiClient {
    constructor(opts) {
      this.opts = opts;
      this.addr = 'fake-nkn-' + Math.random().toString(36).slice(2, 8);
      this._listeners = { connect: [], message: [], error: [] };
      instances.push(this);
    }
    on(event, cb) { (this._listeners[event] ??= []).push(cb); }
    send(/* to, payload */) { return Promise.resolve(); }
    close() {}
    /** Test seam — fire 'connect' so NknTransport flips connected=true. */
    _fireConnect() {
      for (const cb of this._listeners.connect) cb();
    }
    /** Test seam — fire 'message' so NknTransport's _receive runs. */
    _fireMessage(msg) {
      for (const cb of this._listeners.message) cb(msg);
    }
  }
  return { MultiClient, _instances: instances };
}

/**
 * Build a minimal Ed25519 identity (matches AgentIdentity shape from
 * @onderling/core; same construction the loadOrGenerateIdentity path uses).
 */
function makeIdentity() {
  const kp = nacl.sign.keyPair();
  // pubKey as hex string (NknTransport.#deriveSeed expects pubKeyBytes
  // and the rest of @onderling/core expects hex pubKey).
  const pubKeyBytes = kp.publicKey;
  const pubKey      = Array.from(pubKeyBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return {
    pubKey,
    pubKeyBytes,
    privKey:      Array.from(kp.secretKey).map((b) => b.toString(16).padStart(2, '0')).join(''),
    privKeyBytes: kp.secretKey,
    sign:    (_msg) => new Uint8Array(64),  // unused in this test
  };
}

function makeMockAsyncStorage() {
  const store = new Map();
  return {
    _store: store,
    async getItem(k)    { return store.has(k) ? store.get(k) : null; },
    async setItem(k, v) { store.set(k, String(v)); },
    async removeItem(k) { store.delete(k); },
  };
}

describe('#248 buildMeshAgent — NknTransport composition', () => {
  it('attaches agent.nkn when nknLib is provided', async () => {
    const identity = makeIdentity();
    const fakeNkn  = makeFakeNknLib();

    const agent = await buildMeshAgent({
      identity,
      label:           'test-stoop',
      peerGraphPrefix: 'test:peers:',
      nknLib:          fakeNkn,
    });

    expect(agent.nkn).toBeTruthy();
    expect(typeof agent.nkn.sendTo).toBe('function');
    expect(typeof agent.nkn.on).toBe('function');
    expect(typeof agent.nkn.off).toBe('function');
    // The fake client constructed at boot; its address surfaces via
    // the adapter only after 'connect' (the test seam below drives it).
    expect(fakeNkn._instances.length).toBe(1);
  });

  it('omits agent.nkn when nknLib is absent (soft dep)', async () => {
    const identity = makeIdentity();

    const agent = await buildMeshAgent({
      identity,
      label:           'test-stoop',
      peerGraphPrefix: 'test:peers:',
      // no nknLib
    });

    // Property may be `undefined` on the agent — bundle treats null/
    // undefined identically (see buildBundleForGroup spread).
    expect(agent.nkn ?? null).toBe(null);
  });

  it('fans inbound NKN envelopes to peer-message listeners', async () => {
    const identity = makeIdentity();
    const fakeNkn  = makeFakeNknLib();
    const onMsg    = vi.fn();

    const agent = await buildMeshAgent({
      identity,
      label:           'test-stoop',
      peerGraphPrefix: 'test:peers:',
      nknLib:          fakeNkn,
      onNknPeerMessage: onMsg,
    });

    // Drive the fake client through connect + an inbound message.
    const fakeClient = fakeNkn._instances[0];
    fakeClient._fireConnect();

    // NknTransport's `_receive` decrypts via SecurityLayer; agent.addTransport
    // wired SecurityLayer onto our transport.  To exercise the listener path
    // without juggling encryption, we bypass `_receive` and invoke the
    // transport's receiveHandler (which is what `_receive` would call after
    // decrypt) directly — same surface the integration uses.
    const envelope = {
      _from:   'peer-abc',
      payload: { type: 'p2p-chat', subtype: 'catch-up-request', groupId: 'g1', sinceMs: 0 },
      _ts:     1000,
    };
    agent.nkn._transport.receiveHandler(envelope);

    expect(onMsg).toHaveBeenCalledTimes(1);
    expect(onMsg).toHaveBeenCalledWith(expect.objectContaining({
      from:    'peer-abc',
      payload: expect.objectContaining({ subtype: 'catch-up-request' }),
    }));
  });
});

describe('#248 wireCatchUp — scheduleCatchUp + peer router', () => {
  let storage;
  beforeEach(() => { storage = makeMockAsyncStorage(); });

  // A minimal `bundle.nkn` adapter — same shape the real agentBundle
  // exposes (sendTo + on/off('peer-message'|'connect')).  Driven by
  // the test so we don't need a live NknTransport.
  function makeFakeNkn() {
    const listeners = { 'peer-message': new Set(), connect: new Set() };
    return {
      address: 'me-fake-addr',
      sendTo:  vi.fn(async () => {}),
      on(event, cb)  { listeners[event]?.add(cb); },
      off(event, cb) { listeners[event]?.delete(cb); },
      /** Test seam — fire the connect event. */
      _fireConnect() { for (const cb of listeners.connect) cb(); },
      /** Test seam — fire an inbound peer-message. */
      _firePeerMessage(env) { for (const cb of listeners['peer-message']) cb(env); },
    };
  }

  it('scheduleCatchUp calls the lifted requestCatchUpFromKnownPeers when nkn is present', async () => {
    const nkn = makeFakeNkn();
    const bundle = {
      agent: { on() {}, off() {} },
      nkn,
    };
    // Spy callSkill — return shapes that exercise the lifted handler's
    // listMyBuurts → roster → sendPeer fan-out path.
    const callSkill = vi.fn(async (_appOrigin, opId /* , args */) => {
      if (opId === 'listMyBuurts')         return { buurts: ['g1'] };
      if (opId === 'getLatestPostAddedAt') return { latestAt: 12345 };
      if (opId === 'listGroupRoster')      return { members: [{ addr: 'peer-1' }, { addr: 'peer-2' }] };
      return {};
    });

    const { scheduleCatchUp } = wireCatchUp({
      bundle, asyncStorage: storage, callSkill,
    });
    await scheduleCatchUp();

    // The lifted requestCatchUpFromKnownPeers calls:
    //   1× listMyBuurts, 1× getLatestPostAddedAt per buurt, 1× listGroupRoster per buurt
    expect(callSkill).toHaveBeenCalledWith('stoop', 'listMyBuurts', expect.any(Object));
    expect(callSkill).toHaveBeenCalledWith('stoop', 'getLatestPostAddedAt', expect.objectContaining({ groupId: 'g1' }));
    expect(callSkill).toHaveBeenCalledWith('stoop', 'listGroupRoster',      expect.objectContaining({ groupId: 'g1' }));
    // sendPeer fires once per roster member.
    expect(nkn.sendTo).toHaveBeenCalledTimes(2);
    expect(nkn.sendTo).toHaveBeenCalledWith('peer-1', expect.objectContaining({
      type: 'p2p-chat', subtype: 'catch-up-request', groupId: 'g1', sinceMs: 12345,
    }));
  });

  it('inbound catch-up-request routes to handleCatchUpRequest', async () => {
    const nkn = makeFakeNkn();
    const bundle = {
      agent: { on() {}, off() {} },
      nkn,
    };
    // listBuurtPostsSince returns one post → the handler should
    // turn around and sendPeer a buurt-post envelope back.
    const callSkill = vi.fn(async (_appOrigin, opId /* , args */) => {
      if (opId === 'listBuurtPostsSince') {
        return { posts: [{ requestId: 'r-1', text: 'hi', fromPubKey: 'me-fake-addr' }] };
      }
      return {};
    });

    wireCatchUp({ bundle, asyncStorage: storage, callSkill });

    // Simulate an inbound peer-message of subtype catch-up-request.
    nkn._firePeerMessage({
      from:    'peer-asker',
      payload: { type: 'p2p-chat', subtype: 'catch-up-request', groupId: 'g1', sinceMs: 0 },
    });

    // Settle the async handler (router runs the handler async-internally).
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(callSkill).toHaveBeenCalledWith('stoop', 'listBuurtPostsSince', expect.objectContaining({
      groupId: 'g1', sinceMs: 0,
    }));
    // Reply goes back to the asker as a buurt-post envelope.
    expect(nkn.sendTo).toHaveBeenCalledWith('peer-asker', expect.objectContaining({
      type:    'p2p-chat',
      subtype: 'buurt-post',
      groupId: 'g1',
      catchUp: true,
    }));
  });

  it('fires scheduleCatchUp 1.5s after NKN connect', async () => {
    vi.useFakeTimers();
    try {
      const nkn = makeFakeNkn();
      const bundle = {
        agent: { on() {}, off() {} },
        nkn,
      };
      const callSkill = vi.fn(async (_appOrigin, opId) => {
        if (opId === 'listMyBuurts') return { buurts: [] };  // empty fan-out, no sendPeer
        return {};
      });
      wireCatchUp({ bundle, asyncStorage: storage, callSkill });

      // Before connect — nothing fires.
      expect(callSkill).not.toHaveBeenCalled();

      nkn._fireConnect();
      // setTimeout(1500) not yet elapsed.
      expect(callSkill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1500);
      // Drain pending microtasks so the async handler sees the listMyBuurts return.
      await Promise.resolve();
      await Promise.resolve();

      expect(callSkill).toHaveBeenCalledWith('stoop', 'listMyBuurts', expect.any(Object));
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose detaches connect + peer-message listeners', async () => {
    const nkn = makeFakeNkn();
    const bundle = { agent: { on() {}, off() {} }, nkn };
    const callSkill = vi.fn(async () => ({}));

    const { dispose } = wireCatchUp({ bundle, asyncStorage: storage, callSkill });
    dispose();

    // After dispose, firing the events should not invoke callSkill or sendPeer.
    nkn._fireConnect();
    nkn._firePeerMessage({ from: 'peer-x', payload: { subtype: 'catch-up-request', groupId: 'g1' } });
    await new Promise((r) => setImmediate(r));

    expect(callSkill).not.toHaveBeenCalled();
    expect(nkn.sendTo).not.toHaveBeenCalled();
  });
});

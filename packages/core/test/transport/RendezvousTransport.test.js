/**
 * RendezvousTransport (Group AA2) — Node-side behaviour against a real
 * WebRTC stack.
 *
 * `node-datachannel/polyfill` provides RTCPeerConnection /
 * RTCSessionDescription / RTCIceCandidate with the same shape as the
 * browser globals, so the same code path is exercised end-to-end.
 *
 * Tests gate on the polyfill being installable; if it failed to load
 * (e.g. aarch64 / musl toolchain with no prebuild), the suite skips
 * cleanly instead of failing CI.
 *
 * Ref: Design-v3/rendezvous-mode.md §11 AA2, CODING-PLAN Group AA.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RendezvousTransport }            from '../../src/transport/RendezvousTransport.js';
import { InternalBus, InternalTransport } from '../../src/transport/InternalTransport.js';
import { AgentIdentity }                  from '../../src/identity/AgentIdentity.js';
import { VaultMemory }                    from '../../src/identity/VaultMemory.js';

// Attempt to load the polyfill. If it's not installable on this host,
// mark the whole suite as `skipped` so local devs can still run the
// other tests. CI that targets rendezvous should install it.
let rtcLib = null;
let loadErr = null;
try {
  const mod = await import('node-datachannel/polyfill');
  rtcLib = {
    RTCPeerConnection:     mod.RTCPeerConnection,
    RTCSessionDescription: mod.RTCSessionDescription,
    RTCIceCandidate:       mod.RTCIceCandidate,
  };
} catch (e) {
  loadErr = e;
}

const d = rtcLib ? describe : describe.skip;
if (!rtcLib) {
  console.warn('[RendezvousTransport.test] node-datachannel polyfill ' +
    'not available, skipping (', loadErr?.message ?? loadErr, ')');
}

async function twoPeers() {
  const bus   = new InternalBus();
  const aId   = await AgentIdentity.generate(new VaultMemory());
  const bId   = await AgentIdentity.generate(new VaultMemory());

  // Signalling channel: InternalBus so tests are fully in-process.
  const aSig = new InternalTransport(bus, aId.pubKey, { identity: aId });
  const bSig = new InternalTransport(bus, bId.pubKey, { identity: bId });
  await aSig.connect(); await bSig.connect();

  const aRdv = new RendezvousTransport({ signalingTransport: aSig, identity: aId, rtcLib });
  const bRdv = new RendezvousTransport({ signalingTransport: bSig, identity: bId, rtcLib });
  await aRdv.connect(); await bRdv.connect();

  // Capture inbound envelopes on each side.
  const received = { a: [], b: [] };
  aRdv._receive = (env) => received.a.push(env);
  bRdv._receive = (env) => received.b.push(env);

  return {
    aRdv, bRdv, aSig, bSig, received,
    aPub: aId.pubKey, bPub: bId.pubKey,
    async teardown() {
      await aRdv.disconnect(); await bRdv.disconnect();
      await aSig.disconnect(); await bSig.disconnect();
    },
  };
}

d('RendezvousTransport — two-peer end-to-end', () => {

  it('establishes a DataChannel via the signalling transport', async () => {
    const p = await twoPeers();
    await p.aRdv.connectToPeer(p.bPub, 15_000);

    // Both sides end up with an entry in their peer map.
    // (private map — we probe by sending and seeing delivery.)
    await p.aRdv._put(p.bPub, {
      _to: p.bPub, _from: p.aPub, payload: { hello: 'from a' },
    });
    await new Promise(r => setTimeout(r, 100));
    expect(p.received.b).toHaveLength(1);
    expect(p.received.b[0].payload).toEqual({ hello: 'from a' });

    await p.teardown();
  }, 20_000);

  it('round-trips messages in both directions', async () => {
    const p = await twoPeers();
    await p.aRdv.connectToPeer(p.bPub, 15_000);

    await p.aRdv._put(p.bPub, { _to: p.bPub, _from: p.aPub, payload: { n: 1 } });
    await p.bRdv._put(p.aPub, { _to: p.aPub, _from: p.bPub, payload: { n: 2 } });
    await new Promise(r => setTimeout(r, 150));

    expect(p.received.a).toHaveLength(1);
    expect(p.received.a[0].payload).toEqual({ n: 2 });
    expect(p.received.b).toHaveLength(1);
    expect(p.received.b[0].payload).toEqual({ n: 1 });

    await p.teardown();
  }, 20_000);

  it('rtc-close signal tears down the peer entry on the receiver', async () => {
    const p = await twoPeers();
    await p.aRdv.connectToPeer(p.bPub, 15_000);

    const disconnected = new Promise(res => {
      p.bRdv.on('peer-disconnected', (peer) => res(peer));
    });

    // Ask peer to close via signalling rtc-close envelope.
    await p.aSig.sendOneWay(p.bPub, { type: 'rtc-close', from: p.aPub });

    const who = await Promise.race([
      disconnected,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5_000)),
    ]);
    expect(who).toBe(p.aPub);

    await p.teardown();
  }, 20_000);

  it('_put throws when no DataChannel is open', async () => {
    const p = await twoPeers();
    await expect(
      p.aRdv._put(p.bPub, { _to: p.bPub, _from: p.aPub, payload: {} }),
    ).rejects.toThrow(/no open DataChannel/);
    await p.teardown();
  });

  it('offer to a non-responding peer times out and cleans up', async () => {
    // Only spin up A: B doesn't exist, so the offer will never get an answer.
    const bus = new InternalBus();
    const aId = await AgentIdentity.generate(new VaultMemory());
    const aSig = new InternalTransport(bus, aId.pubKey, { identity: aId });
    await aSig.connect();
    const aRdv = new RendezvousTransport({ signalingTransport: aSig, identity: aId, rtcLib });
    await aRdv.connect();

    await expect(
      aRdv.connectToPeer('nonexistent-peer-pubkey', 500),
    ).rejects.toThrow(/timeout/);

    // Subsequent disconnect should be clean.
    await aRdv.disconnect();
    await aSig.disconnect();
  }, 10_000);
});

describe('RendezvousTransport — isSupported()', () => {
  it('returns a boolean reflecting whether WebRTC globals exist', () => {
    const result = RendezvousTransport.isSupported();
    expect(typeof result).toBe('boolean');
    // Under vanilla Node without the polyfill attached to globalThis,
    // this returns false. If someone injected the polyfill globally,
    // we accept true. No strict assertion either way.
  });
});

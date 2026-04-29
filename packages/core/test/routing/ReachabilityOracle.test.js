/**
 * ReachabilityOracle — push-side oracle gossip + bridge lookup (Track G1).
 *
 * Covers:
 *   - constructor validation
 *   - immediate broadcast on start
 *   - heartbeat re-broadcast (Q-G.1)
 *   - change-driven re-broadcast on transport-add/remove (Q-G.1)
 *   - manual notifyTransportChange()
 *   - bridgeFor() resolution + null when oracle is silent
 *   - TTL-based eviction (Q-G.2)
 *   - signature/issuer mismatch is rejected
 *   - replay guard (s ≤ lastSeenSeq)
 *   - stop halts heartbeat + listeners
 *   - idempotent start/stop
 */
import { describe, it, expect, vi } from 'vitest';
import { Emitter }                  from '../../src/Emitter.js';
import { DataPart }                  from '../../src/Parts.js';
import { AgentIdentity }             from '../../src/identity/AgentIdentity.js';
import { VaultMemory }               from '../../src/identity/VaultMemory.js';
import { signReachabilityClaim }     from '../../src/security/reachabilityClaim.js';
import {
  ReachabilityOracle,
  ORACLE_TOPIC,
  DEFAULT_TTL_MS,
  DEFAULT_INTERVAL_MS,
}                                    from '../../src/routing/ReachabilityOracle.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function freshIdentity() {
  return AgentIdentity.generate(new VaultMemory());
}

/**
 * Minimal agent-like double: Emitter + publish() + peers.all().
 * Captures every publish() call for inspection.
 */
function makeAgentLike({ pubKey, peerList = [] } = {}) {
  const agent = new Emitter();
  agent.pubKey = pubKey ?? 'me-pubkey';
  agent.publish = vi.fn(async () => {});
  agent.peers   = {
    all: vi.fn(async () => peerList),
  };
  return agent;
}

/** Wait one macrotask so setInterval / microtasks can flush. */
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

/** Inject a claim into the oracle as if it arrived via a `publish` event. */
function deliverClaim(agent, claim, from = 'gossip-source') {
  agent.emit('publish', {
    from,
    topic: ORACLE_TOPIC,
    parts: [DataPart(claim)],
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReachabilityOracle — constructor validation', () => {
  it('throws when agent is missing', async () => {
    const id = await freshIdentity();
    expect(() => new ReachabilityOracle({ identity: id })).toThrow(/agent is required/);
  });

  it('throws when identity is missing', () => {
    const agent = makeAgentLike();
    expect(() => new ReachabilityOracle({ agent })).toThrow(/identity is required/);
  });

  it('uses sane defaults when ttlMs / intervalMs are unspecified', async () => {
    const id    = await freshIdentity();
    const agent = makeAgentLike({ pubKey: id.pubKey });
    // Just construct — no throw, no side effects until start().
    const oracle = new ReachabilityOracle({ agent, identity: id });
    expect(oracle).toBeInstanceOf(ReachabilityOracle);
    expect(DEFAULT_TTL_MS).toBe(5 * 60_000);
    expect(DEFAULT_INTERVAL_MS).toBe(60_000);
  });
});

describe('ReachabilityOracle — broadcast lifecycle', () => {
  it('broadcasts the agent\'s claim immediately on start', async () => {
    const id    = await freshIdentity();
    const agent = makeAgentLike({ pubKey: id.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: id, intervalMs: 60_000, ttlMs: 60_000,
    });

    oracle.start();
    await tick(0);
    await tick(0);

    expect(agent.publish).toHaveBeenCalled();
    const [topic, claim] = agent.publish.mock.calls[0];
    expect(topic).toBe(ORACLE_TOPIC);
    expect(claim?.body?.i).toBe(id.pubKey);
    expect(typeof claim?.sig).toBe('string');

    oracle.stop();
  });

  it('heartbeat re-broadcasts every intervalMs', async () => {
    const id    = await freshIdentity();
    const agent = makeAgentLike({ pubKey: id.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: id, intervalMs: 30, ttlMs: 60_000,
    });

    oracle.start();
    await tick(150);

    // Initial broadcast + at least 3 heartbeats in 150ms at 30ms cadence.
    expect(agent.publish.mock.calls.length).toBeGreaterThanOrEqual(3);

    oracle.stop();
  });

  it('change-driven re-broadcast on transport-added / transport-removed', async () => {
    const id    = await freshIdentity();
    const agent = makeAgentLike({ pubKey: id.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: id, intervalMs: 60_000, ttlMs: 60_000, changeDriven: true,
    });

    oracle.start();
    await tick(0); await tick(0);
    const initial = agent.publish.mock.calls.length;
    expect(initial).toBeGreaterThanOrEqual(1);

    agent.emit('transport-added', { name: 'ble' });
    await tick(0); await tick(0);
    agent.emit('transport-removed', { name: 'ble' });
    await tick(0); await tick(0);

    expect(agent.publish.mock.calls.length).toBeGreaterThanOrEqual(initial + 2);

    oracle.stop();
  });

  it('change-driven=false → transport events do NOT trigger re-broadcast', async () => {
    const id    = await freshIdentity();
    const agent = makeAgentLike({ pubKey: id.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: id, intervalMs: 60_000, ttlMs: 60_000, changeDriven: false,
    });

    oracle.start();
    await tick(0); await tick(0);
    const before = agent.publish.mock.calls.length;

    agent.emit('transport-added',   { name: 'ble' });
    agent.emit('transport-removed', { name: 'ble' });
    await tick(0); await tick(0);

    expect(agent.publish.mock.calls.length).toBe(before);

    oracle.stop();
  });

  it('notifyTransportChange() forces an extra broadcast', async () => {
    const id    = await freshIdentity();
    const agent = makeAgentLike({ pubKey: id.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: id, intervalMs: 60_000, ttlMs: 60_000, changeDriven: false,
    });

    oracle.start();
    await tick(0); await tick(0);
    const before = agent.publish.mock.calls.length;

    await oracle.notifyTransportChange();
    expect(agent.publish.mock.calls.length).toBeGreaterThanOrEqual(before + 1);

    oracle.stop();
  });

  it('stop() halts the heartbeat', async () => {
    const id    = await freshIdentity();
    const agent = makeAgentLike({ pubKey: id.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: id, intervalMs: 20, ttlMs: 60_000,
    });

    oracle.start();
    await tick(80);
    const beforeStop = agent.publish.mock.calls.length;
    expect(beforeStop).toBeGreaterThanOrEqual(2);

    oracle.stop();
    await tick(80);

    // Allow at most one in-flight broadcast that started before stop().
    expect(agent.publish.mock.calls.length - beforeStop).toBeLessThanOrEqual(1);
  });

  it('start() and stop() are idempotent', async () => {
    const id    = await freshIdentity();
    const agent = makeAgentLike({ pubKey: id.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: id, intervalMs: 60_000, ttlMs: 60_000,
    });

    oracle.start();
    oracle.start();             // second start — no-op
    await tick(0); await tick(0);
    const afterStart = agent.publish.mock.calls.length;
    expect(afterStart).toBeGreaterThanOrEqual(1);

    oracle.stop();
    oracle.stop();              // second stop — no-op
    expect(() => oracle.stop()).not.toThrow();
  });

  it('snapshots direct-peer pubkeys from the PeerGraph (filters self / hops > 0 / unreachable)', async () => {
    const id    = await freshIdentity();
    const agent = makeAgentLike({
      pubKey: id.pubKey,
      peerList: [
        { pubKey: id.pubKey, hops: 0, reachable: true },                // self — filtered
        { pubKey: 'pkDirect',   hops: 0, reachable: true },             // included
        { pubKey: 'pkIndirect', hops: 1, reachable: true },             // filtered (indirect)
        { pubKey: 'pkDown',     hops: 0, reachable: false },            // filtered (unreachable)
      ],
    });
    const oracle = new ReachabilityOracle({
      agent, identity: id, intervalMs: 60_000, ttlMs: 60_000,
    });

    oracle.start();
    await tick(0); await tick(0);

    const [, claim] = agent.publish.mock.calls[0];
    expect(claim.body.p).toEqual(['pkDirect']);

    oracle.stop();
  });
});

describe('ReachabilityOracle — bridgeFor() lookup', () => {
  it('returns null when no entries have been received', async () => {
    const id    = await freshIdentity();
    const agent = makeAgentLike({ pubKey: id.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: id, intervalMs: 60_000, ttlMs: 60_000,
    });
    oracle.start();
    expect(oracle.bridgeFor('any')).toBeNull();
    expect(oracle.size).toBe(0);
    oracle.stop();
  });

  it('returns the issuer as the bridge after a verified claim is delivered', async () => {
    const me    = await freshIdentity();
    const peer  = await freshIdentity();
    const agent = makeAgentLike({ pubKey: me.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: me, intervalMs: 60_000, ttlMs: 60_000,
    });
    oracle.start();

    const claim = await signReachabilityClaim(peer, ['target-1', 'target-2'], { ttlMs: 60_000 });
    const updates = [];
    oracle.on('peer-updated', e => updates.push(e));

    deliverClaim(agent, claim, 'wire-source');
    await tick(0);

    expect(updates).toHaveLength(1);
    expect(updates[0].peerId).toBe(peer.pubKey);
    expect(oracle.size).toBe(1);

    const pick = oracle.bridgeFor('target-1');
    expect(pick).toBeTruthy();
    expect(pick.bridge).toBe(peer.pubKey);

    expect(oracle.bridgeFor('not-in-claim')).toBeNull();

    oracle.stop();
  });

  it('orders multiple matching issuers lexicographically for determinism', async () => {
    const me   = await freshIdentity();
    // Distinguish issuers by sorted pubKey order — generate two and pick consistent labels.
    const a = await freshIdentity();
    const b = await freshIdentity();
    const [first, second] = a.pubKey < b.pubKey ? [a, b] : [b, a];

    const agent = makeAgentLike({ pubKey: me.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: me, intervalMs: 60_000, ttlMs: 60_000,
    });
    oracle.start();

    const c1 = await signReachabilityClaim(first,  ['shared-target'], { ttlMs: 60_000 });
    const c2 = await signReachabilityClaim(second, ['shared-target'], { ttlMs: 60_000 });
    deliverClaim(agent, c1);
    deliverClaim(agent, c2);
    await tick(0);

    expect(oracle.size).toBe(2);
    expect(oracle.bridgeFor('shared-target').bridge).toBe(first.pubKey);

    oracle.stop();
  });
});

describe('ReachabilityOracle — TTL eviction', () => {
  it('evicts entries after ttlMs and bridgeFor returns null', async () => {
    const me   = await freshIdentity();
    const peer = await freshIdentity();
    const agent = makeAgentLike({ pubKey: me.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: me, intervalMs: 60_000, ttlMs: 30,  // tiny TTL
    });
    oracle.start();

    const claim = await signReachabilityClaim(peer, ['target-x'], { ttlMs: 30 });
    deliverClaim(agent, claim);
    await tick(0);

    expect(oracle.bridgeFor('target-x').bridge).toBe(peer.pubKey);

    await tick(60);   // wait past TTL
    expect(oracle.bridgeFor('target-x')).toBeNull();
    expect(oracle.size).toBe(0);

    oracle.stop();
  });
});

describe('ReachabilityOracle — verification rejects bad input', () => {
  it('rejects a tampered claim (signature mismatch)', async () => {
    const me   = await freshIdentity();
    const peer = await freshIdentity();
    const agent = makeAgentLike({ pubKey: me.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: me, intervalMs: 60_000, ttlMs: 60_000,
    });
    oracle.start();

    const rejections = [];
    oracle.on('claim-rejected', e => rejections.push(e));

    const claim = await signReachabilityClaim(peer, ['victim'], { ttlMs: 60_000 });
    // Tamper: replace `p` with the same shape but different content (still sorted).
    claim.body.p = ['attacker'];
    deliverClaim(agent, claim);
    await tick(0);

    expect(rejections).toHaveLength(1);
    expect(rejections[0].reason).toMatch(/bad signature/);
    expect(oracle.size).toBe(0);
    expect(oracle.bridgeFor('victim')).toBeNull();

    oracle.stop();
  });

  it('rejects a replay (s ≤ lastSeenSeq)', async () => {
    const me   = await freshIdentity();
    const peer = await freshIdentity();
    const agent = makeAgentLike({ pubKey: me.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: me, intervalMs: 60_000, ttlMs: 60_000,
    });
    oracle.start();

    const rejections = [];
    oracle.on('claim-rejected', e => rejections.push(e));

    const c1 = await signReachabilityClaim(peer, ['target-a'], { ttlMs: 60_000 });
    deliverClaim(agent, c1);
    await tick(0);
    expect(oracle.size).toBe(1);

    // Replay the same claim — must be rejected; entry stays as-is.
    deliverClaim(agent, c1);
    await tick(0);
    expect(rejections).toHaveLength(1);
    expect(rejections[0].reason).toMatch(/replay/);
    expect(oracle.size).toBe(1);

    oracle.stop();
  });

  it('ignores publish events on unrelated topics', async () => {
    const me    = await freshIdentity();
    const peer  = await freshIdentity();
    const agent = makeAgentLike({ pubKey: me.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: me, intervalMs: 60_000, ttlMs: 60_000,
    });
    oracle.start();

    const claim = await signReachabilityClaim(peer, ['target-z'], { ttlMs: 60_000 });
    agent.emit('publish', { from: 'whoever', topic: 'some-other-topic', parts: [DataPart(claim)] });
    await tick(0);

    expect(oracle.size).toBe(0);
    oracle.stop();
  });

  it('ignores malformed publish payloads (no DataPart)', async () => {
    const me    = await freshIdentity();
    const agent = makeAgentLike({ pubKey: me.pubKey });
    const oracle = new ReachabilityOracle({
      agent, identity: me, intervalMs: 60_000, ttlMs: 60_000,
    });
    oracle.start();

    agent.emit('publish', { from: 'x', topic: ORACLE_TOPIC, parts: [] });
    agent.emit('publish', { from: 'x', topic: ORACLE_TOPIC, parts: null });
    agent.emit('publish', { from: 'x', topic: ORACLE_TOPIC });
    await tick(0);

    expect(oracle.size).toBe(0);
    oracle.stop();
  });
});

describe('ReachabilityOracle — bridgeFor integration with hopBridges', () => {
  it('hopBridges.buildBridgeList prepends the oracle bridge when set', async () => {
    const { buildBridgeList } = await import('../../src/routing/hopBridges.js');

    const me      = await freshIdentity();
    const bridge  = await freshIdentity();
    const target  = 'target-pubkey';

    // Build a real ReachabilityOracle with a delivered claim.
    const agent = makeAgentLike({
      pubKey: me.pubKey,
      peerList: [
        { pubKey: bridge.pubKey, hops: 0, reachable: true },
        { pubKey: 'other-direct', hops: 0, reachable: true },
      ],
    });
    const oracle = new ReachabilityOracle({
      agent, identity: me, intervalMs: 60_000, ttlMs: 60_000,
    });
    oracle.start();

    const claim = await signReachabilityClaim(bridge, [target], { ttlMs: 60_000 });
    deliverClaim(agent, claim);
    await tick(0);

    // Wire oracle onto agent the way hopBridges expects.
    agent.reachabilityOracle = oracle;

    const bridges = await buildBridgeList(agent, target, null);
    expect(bridges[0]).toBe(bridge.pubKey);  // oracle pick first

    oracle.stop();
  });

  it('hopBridges.buildBridgeList behaves identically when no oracle is wired', async () => {
    const { buildBridgeList } = await import('../../src/routing/hopBridges.js');

    const target = 'target-pubkey';
    const agent  = makeAgentLike({
      pubKey: 'me',
      peerList: [
        { pubKey: 'a', hops: 0, reachable: true },
        { pubKey: 'b', hops: 0, reachable: true },
      ],
    });

    const bridges = await buildBridgeList(agent, target, { via: 'a' });
    // record.via 'a' first, then 'b'; no oracle prepend.
    expect(bridges).toEqual(['a', 'b']);
  });
});

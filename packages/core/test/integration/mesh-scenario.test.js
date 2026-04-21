/**
 * mesh-scenario — end-to-end integration test.
 *
 * Three-agent topology (relay bus ↔ Bob ↔ loopback bus):
 *   Alice, Bob, Carol
 *
 * Covers phases 1–6 (base) and phase 9 (oracle, now that Group T is in).
 * Phases 7 (BLE buffer / Group V) and 8 (hello gate / Group W) are
 * marked `.skip` until those groups ship.
 *
 * Ref: EXTRACTION-PLAN.md §7 Group Y; CODING-PLAN.md Group Y.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildMesh, gossipOnce, gossipOracle, TextPart, Parts } from './scenario.js';

describe('Group Y — mesh scenario', () => {

  it('phase 1-2: boot, hello, direct graph reflects hops:0', async () => {
    const m = await buildMesh();

    // Direct hellos exercise the protocol.
    await m.alice.hello(m.pubKeys.bob);
    await m.bob.hello(m.pubKeys.carol);

    expect(m.alice.security.getPeerKey(m.pubKeys.bob)).toBeTruthy();
    expect(m.bob.security.getPeerKey(m.pubKeys.alice)).toBeTruthy();
    expect(m.bob.security.getPeerKey(m.pubKeys.carol)).toBeTruthy();
    expect(m.carol.security.getPeerKey(m.pubKeys.bob)).toBeTruthy();

    const aliceBobRec = await m.alice.peers.get(m.pubKeys.bob);
    expect(aliceBobRec.hops ?? 0).toBe(0);

    await m.teardown();
  });

  it('phase 3: gossip populates indirect peer (alice learns about carol via bob)', async () => {
    const m = await buildMesh();

    // Alice gossips with Bob — learns about Carol as an indirect peer.
    const added = await gossipOnce(m.alice, m.pubKeys.bob);
    expect(added).toBe(1);

    const carolRec = await m.alice.peers.get(m.pubKeys.carol);
    expect(carolRec).toBeTruthy();
    expect(carolRec.hops).toBe(1);
    expect(carolRec.via).toBe(m.pubKeys.bob);

    await m.teardown();
  });

  it('phase 4-5: alice → carol and back, via bob; origin is preserved', async () => {
    const m = await buildMesh();
    await gossipOnce(m.alice, m.pubKeys.bob);
    await gossipOnce(m.carol, m.pubKeys.bob);  // so carol can reach alice too

    // Alice → Carol (hop via Bob).
    await m.alice.invokeWithHop(m.pubKeys.carol, 'receive-message', [TextPart('hi carol')]);

    expect(m.received.carol).toHaveLength(1);
    expect(m.received.carol[0].text).toBe('hi carol');
    expect(m.received.carol[0].originFrom).toBe(m.pubKeys.alice);
    expect(m.received.carol[0].relayedBy).toBe(m.pubKeys.bob);

    // Carol → Alice (also via Bob).
    await m.carol.invokeWithHop(m.pubKeys.alice, 'receive-message', [TextPart('hi alice')]);
    expect(m.received.alice).toHaveLength(1);
    expect(m.received.alice[0].text).toBe('hi alice');
    expect(m.received.alice[0].originFrom).toBe(m.pubKeys.carol);
    expect(m.received.alice[0].relayedBy).toBe(m.pubKeys.bob);

    await m.teardown();
  });

  it('phase 6: agent.forget removes the peer; re-hello re-registers the key', async () => {
    const m = await buildMesh();
    await m.alice.hello(m.pubKeys.bob);

    // Precondition
    expect(m.alice.security.getPeerKey(m.pubKeys.bob)).toBeTruthy();
    expect(await m.alice.peers.get(m.pubKeys.bob)).toBeTruthy();

    await m.alice.forget(m.pubKeys.bob);

    expect(m.alice.security.getPeerKey(m.pubKeys.bob)).toBeNull();
    expect(await m.alice.peers.get(m.pubKeys.bob)).toBeNull();

    // Re-hello restores the state.
    await m.alice.hello(m.pubKeys.bob);
    expect(m.alice.security.getPeerKey(m.pubKeys.bob)).toBeTruthy();

    await m.teardown();
  });

  // ── Conditional phases ─────────────────────────────────────────────────────

  it.skip('phase 7 (V): BLE store-and-forward buffers during a disconnect', () => {
    // TODO: unskip when Group V (BLE buffer) lands.
    // Simulate a short loopback disconnect, send from Alice, reconnect,
    // assert the buffered message reaches Carol.
  });

  it.skip('phase 8 (W): hello-gate rejects silently without a matching token', () => {
    // TODO: unskip when Group W (hello gate) lands.
  });

  it('phase 9 (T): oracle picks the right bridge on the first try', async () => {
    const m = await buildMesh();
    await m.alice.hello(m.pubKeys.bob);
    await m.bob.hello(m.pubKeys.carol);
    await gossipOnce(m.alice, m.pubKeys.bob);    // alice learns carol (hops:1, via:bob)

    // All three enable the oracle so there's a claim to publish.
    m.alice.enableReachabilityOracle({ ttlMs: 60_000 });
    m.bob.enableReachabilityOracle({ ttlMs: 60_000 });
    m.carol.enableReachabilityOracle({ ttlMs: 60_000 });

    // One "oracle gossip" round — alice pulls Bob's signed claim.
    const ok = await gossipOracle(m.alice, m.pubKeys.bob);
    expect(ok).toBe(true);

    const bobRec = await m.alice.peers.get(m.pubKeys.bob);
    expect(bobRec.knownPeers).toContain(m.pubKeys.carol);
    expect(bobRec.knownPeersTs).toBeGreaterThan(Date.now());

    // Spy on invoke so we can see exactly which bridge invokeWithHop picks.
    const invokeSpy = vi.spyOn(m.alice, 'invoke');

    await m.alice.invokeWithHop(m.pubKeys.carol, 'receive-message', [TextPart('oracle hello')]);

    // The first invoke from invokeWithHop must be the relay-forward call
    // to Bob (oracle pick) — not any other bridge or a probe attempt first.
    const relayForwardCall = invokeSpy.mock.calls.find(c => c[1] === 'relay-forward');
    expect(relayForwardCall).toBeTruthy();
    expect(relayForwardCall[0]).toBe(m.pubKeys.bob);
    // And it must be the FIRST relay-forward call (no wasted attempts before it).
    const firstRelayIdx = invokeSpy.mock.calls.findIndex(c => c[1] === 'relay-forward');
    const earlierRelayCalls = invokeSpy.mock.calls
      .slice(0, firstRelayIdx)
      .filter(c => c[1] === 'relay-forward');
    expect(earlierRelayCalls).toHaveLength(0);

    // And the message arrived.
    expect(m.received.carol.at(-1).text).toBe('oracle hello');

    // ── Follow-up: expire the claim and confirm probe-retry still works. ───
    const rec = await m.alice.peers.get(m.pubKeys.bob);
    rec.knownPeersTs = 0;                                  // force stale
    await m.alice.peers.upsert(rec);

    invokeSpy.mockClear();
    m.received.carol.length = 0;

    await m.alice.invokeWithHop(m.pubKeys.carol, 'receive-message', [TextPart('after expiry')]);

    expect(m.received.carol.at(-1).text).toBe('after expiry');
    // Still a relay-forward call — just via probe-retry now. We don't care
    // about call order here, only that delivery succeeded.
    expect(invokeSpy.mock.calls.some(c => c[1] === 'relay-forward')).toBe(true);

    invokeSpy.mockRestore();
    await m.teardown();
  });
});

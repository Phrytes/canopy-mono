/**
 * PeerGraph.knownPeers storage — Group T4.
 *
 * Exercises the knownPeers / knownPeersTs / knownPeersSeq / knownPeersSig
 * fields so Group T5/T6 can rely on them. See CODING-PLAN.md Group T4.
 */
import { describe, it, expect } from 'vitest';
import { PeerGraph } from '../src/discovery/PeerGraph.js';

describe('PeerGraph.knownPeers storage', () => {

  it('persists knownPeers + knownPeersTs + knownPeersSeq + knownPeersSig together', async () => {
    const g = new PeerGraph();
    await g.upsert({
      pubKey:         'bridge-pk',
      hops:           0,
      reachable:      true,
      knownPeers:     ['targetA', 'targetB'],
      knownPeersTs:   Date.now() + 60_000,
      knownPeersSeq:  42,
      knownPeersSig:  'sig-blob',
    });

    const rec = await g.get('bridge-pk');
    expect(rec.knownPeers).toEqual(['targetA', 'targetB']);
    expect(rec.knownPeersSeq).toBe(42);
    expect(rec.knownPeersSig).toBe('sig-blob');
    expect(rec.knownPeersTs).toBeGreaterThan(Date.now());
  });

  it('replaces the peer list atomically with a newer knownPeersSeq', async () => {
    const g = new PeerGraph();
    await g.upsert({
      pubKey:         'bridge-pk',
      knownPeers:     ['old1', 'old2', 'old3'],
      knownPeersTs:   Date.now() + 60_000,
      knownPeersSeq:  10,
    });
    await g.upsert({
      pubKey:         'bridge-pk',
      knownPeers:     ['only1'],
      knownPeersTs:   Date.now() + 120_000,
      knownPeersSeq:  11,
    });

    const rec = await g.get('bridge-pk');
    // replaced, not merged
    expect(rec.knownPeers).toEqual(['only1']);
    expect(rec.knownPeersSeq).toBe(11);
  });

  it('does not clobber existing knownPeers when an upsert omits them', async () => {
    const g = new PeerGraph();
    await g.upsert({
      pubKey:         'bridge-pk',
      knownPeers:     ['keep1', 'keep2'],
      knownPeersTs:   Date.now() + 60_000,
      knownPeersSeq:  7,
    });

    // Later, a hello re-upserts just the direct-connection fields.
    await g.upsert({
      pubKey:    'bridge-pk',
      hops:      0,
      reachable: true,
      label:     'alice',
    });

    const rec = await g.get('bridge-pk');
    expect(rec.knownPeers).toEqual(['keep1', 'keep2']);
    expect(rec.knownPeersSeq).toBe(7);
    expect(rec.label).toBe('alice');
  });

  it('freshness check: now < knownPeersTs is fresh; >= is stale', async () => {
    const g = new PeerGraph();
    const now = Date.now();
    await g.upsert({
      pubKey:         'fresh',
      knownPeers:     ['x'],
      knownPeersTs:   now + 60_000,
      knownPeersSeq:  1,
    });
    await g.upsert({
      pubKey:         'stale',
      knownPeers:     ['y'],
      knownPeersTs:   now - 1,
      knownPeersSeq:  1,
    });

    const fresh = await g.get('fresh');
    const stale = await g.get('stale');
    expect(Date.now() < fresh.knownPeersTs).toBe(true);
    expect(Date.now() < stale.knownPeersTs).toBe(false);
  });

  it('supports records with knownPeers but no other transport info', async () => {
    // Typical oracle-only upsert that happens via GossipProtocol for an
    // indirect peer: we haven't hello'd them, we just cache what a
    // bridge claims they can reach.
    const g = new PeerGraph();
    await g.upsert({
      pubKey:         'indirect-bridge',
      hops:           0,
      knownPeers:     ['deep-peer-1'],
      knownPeersTs:   Date.now() + 30_000,
      knownPeersSeq:  100,
    });

    const rec = await g.get('indirect-bridge');
    expect(rec.knownPeers).toEqual(['deep-peer-1']);
    expect(rec.reachable).toBe(true);  // default
  });
});

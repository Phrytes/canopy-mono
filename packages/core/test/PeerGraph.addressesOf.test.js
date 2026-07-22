/**
 * PeerGraph.addressesOf() — Connectivity Phase 1, Part B (B2 / G5).
 *
 * The canonical peer-id → per-transport address map: a peer exposes a different
 * wire address per transport (relay = pubKey, nkn = native addr), and a send must
 * resolve the transport-appropriate one.
 */
import { describe, it, expect } from 'vitest';
import { PeerGraph } from '../src/discovery/PeerGraph.js';

describe('PeerGraph.addressesOf()', () => {
  it('resolves nkn vs relay for a peer that has both', async () => {
    const graph = new PeerGraph();
    await graph.upsert({
      pubKey: 'PK',
      transports: {
        relay: { address: 'PK' },                 // relay addresses by the pubKey
        nkn:   { address: 'nkn-native-addr-xyz' }, // NKN by its seed-derived native addr
      },
    });
    expect(await graph.addressesOf('PK')).toEqual({
      relay: 'PK',
      nkn:   'nkn-native-addr-xyz',
    });
  });

  it('accepts a bare string or a {url} transport entry', async () => {
    const graph = new PeerGraph();
    await graph.upsert({ pubKey: 'PK', transports: { relay: 'PK', a2a: { url: 'https://x/y' } } });
    expect(await graph.addressesOf('PK')).toEqual({ relay: 'PK', a2a: 'https://x/y' });
  });

  it('returns {} for an unknown peer or a peer with no transports', async () => {
    const graph = new PeerGraph();
    expect(await graph.addressesOf('missing')).toEqual({});
    await graph.upsert({ pubKey: 'bare' });
    expect(await graph.addressesOf('bare')).toEqual({});
  });

  it('reflects the merged transports after successive upserts', async () => {
    const graph = new PeerGraph();
    await graph.upsert({ pubKey: 'PK', transports: { relay: { address: 'PK' } } });
    await graph.upsert({ pubKey: 'PK', transports: { nkn: { address: 'nkn-addr' } } });
    expect(await graph.addressesOf('PK')).toEqual({ relay: 'PK', nkn: 'nkn-addr' });
  });
});

/**
 * pullPeerList — gossip-initiator helper tests.
 * See EXTRACTION-PLAN.md Group M.
 */
import { describe, it, expect, vi } from 'vitest';
import { pullPeerList } from '../src/discovery/pullPeerList.js';
import { PeerGraph } from '../src/discovery/PeerGraph.js';
import { DataPart } from '../src/Parts.js';

const SELF   = 'self_pubkey_0000000000';
const DIRECT = 'direct_pubkey_0000000000';

function makeAgent(peerListResponse) {
  return {
    pubKey: SELF,
    peers:  new PeerGraph(),
    invoke: vi.fn(async () => [DataPart({ peers: peerListResponse })]),
  };
}

describe('pullPeerList', () => {
  it('adds returned peers as hops:1 with via=directPeer', async () => {
    const agent = makeAgent([
      { pubKey: 'peerA', label: 'Alice' },
      { pubKey: 'peerB', label: 'Bob'   },
    ]);

    const added = await pullPeerList(agent, DIRECT);
    expect(added).toBe(2);

    const a = await agent.peers.get('peerA');
    expect(a.hops).toBe(1);
    expect(a.via).toBe(DIRECT);
    expect(a.label).toBe('Alice');
    expect(a.reachable).toBe(true);

    const b = await agent.peers.get('peerB');
    expect(b.hops).toBe(1);
    expect(b.via).toBe(DIRECT);
  });

  it('skips own pubKey and the direct peer itself', async () => {
    const agent = makeAgent([
      { pubKey: SELF,   label: 'me'     },
      { pubKey: DIRECT, label: 'direct' },
      { pubKey: 'peerC' },
    ]);

    const added = await pullPeerList(agent, DIRECT);
    expect(added).toBe(1);
    expect(await agent.peers.get(SELF)).toBe(null);
    // DIRECT also shouldn't be added as an indirect record.
    expect(await agent.peers.get(DIRECT)).toBe(null);
    expect(await agent.peers.get('peerC')).not.toBe(null);
  });

  it('does not downgrade an existing direct (hops:0) record', async () => {
    const agent = makeAgent([{ pubKey: 'peerX', label: 'was-direct' }]);
    await agent.peers.upsert({
      type: 'native', pubKey: 'peerX', hops: 0, reachable: true, label: 'direct-label',
    });

    await pullPeerList(agent, DIRECT);

    const x = await agent.peers.get('peerX');
    expect(x.hops).toBe(0);     // still direct
    expect(x.via).toBeUndefined();
    expect(x.label).toBe('direct-label');
  });

  it('handles malformed cards gracefully', async () => {
    const agent = makeAgent([
      null,
      {},                 // no pubKey
      { pubKey: 'peerY' },
    ]);

    const added = await pullPeerList(agent, DIRECT);
    expect(added).toBe(1);
    expect(await agent.peers.get('peerY')).not.toBe(null);
  });

  it('returns 0 and does not throw when the peer can\'t be invoked', async () => {
    const agent = {
      pubKey: SELF,
      peers: new PeerGraph(),
      invoke: vi.fn(async () => { throw new Error('peer unreachable'); }),
    };
    const added = await pullPeerList(agent, DIRECT);
    expect(added).toBe(0);
  });

  it('returns 0 when the response has no peers array', async () => {
    const agent = {
      pubKey: SELF,
      peers:  new PeerGraph(),
      invoke: vi.fn(async () => [DataPart({ other: 'shape' })]),
    };
    expect(await pullPeerList(agent, DIRECT)).toBe(0);
  });

  it('is a no-op when agent.peers is absent', async () => {
    const agent = { pubKey: SELF, invoke: vi.fn() };
    expect(await pullPeerList(agent, DIRECT)).toBe(0);
    expect(agent.invoke).not.toHaveBeenCalled();
  });
});

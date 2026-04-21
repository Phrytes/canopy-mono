import { describe, it, expect } from 'vitest';
import { Agent }                  from '../src/Agent.js';
import { AgentIdentity }          from '../src/identity/AgentIdentity.js';
import { VaultMemory }            from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { ping }                   from '../src/protocol/ping.js';

async function makePair() {
  const bus   = new InternalBus();
  const aId   = await AgentIdentity.generate(new VaultMemory());
  const bId   = await AgentIdentity.generate(new VaultMemory());
  const alice = new Agent({ identity: aId, transport: new InternalTransport(bus, aId.pubKey) });
  const bob   = new Agent({ identity: bId, transport: new InternalTransport(bus, bId.pubKey) });
  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start();
  await bob.start();
  return { alice, bob };
}

describe('ping', () => {
  it('returns a non-negative number (round-trip ms)', async () => {
    const { alice, bob } = await makePair();
    const rtt = await ping(alice, bob.address);
    expect(typeof rtt).toBe('number');
    expect(rtt).toBeGreaterThanOrEqual(0);
  });

  it('is also accessible via Agent.transport.sendAck', async () => {
    const { alice, bob } = await makePair();
    // ping is a thin wrapper around sendAck — verify the transport level works
    await expect(
      alice.transport.sendAck(bob.address, { type: 'ping' }, 5_000)
    ).resolves.toBeDefined();
  });

  it('returns null on timeout', async () => {
    const { alice } = await makePair();
    const deadPeer = 'nonexistent-address';
    const rtt = await ping(alice, deadPeer, 100);
    expect(rtt).toBeNull();
  });

  it('round-trip is fast for in-process transport', async () => {
    const { alice, bob } = await makePair();
    const rtt = await ping(alice, bob.address, 1_000);
    expect(rtt).not.toBeNull();
    expect(rtt).toBeLessThan(500);
  });
});

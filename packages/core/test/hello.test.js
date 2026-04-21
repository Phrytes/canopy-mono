import { describe, it, expect } from 'vitest';
import { Agent }                      from '../src/Agent.js';
import { AgentIdentity }              from '../src/identity/AgentIdentity.js';
import { VaultMemory }                from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';

async function makeAgent(bus) {
  const id = await AgentIdentity.generate(new VaultMemory());
  return new Agent({ identity: id, transport: new InternalTransport(bus, id.pubKey) });
}

describe('hello handshake', () => {
  it('sendHello registers both peers without addPeer()', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus);

    await alice.start();
    await bob.start();

    // Neither side has the other registered yet.
    expect(alice.security.getPeerKey(bob.address)).toBeNull();
    expect(bob.security.getPeerKey(alice.address)).toBeNull();

    await alice.hello(bob.address);

    // Both sides should now have each other registered.
    expect(alice.security.getPeerKey(bob.address)).toBe(bob.pubKey);
    expect(bob.security.getPeerKey(alice.address)).toBe(alice.pubKey);
  });

  it('emits peer event on both sides', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus);

    await alice.start();
    await bob.start();

    const alicePeers = [];
    const bobPeers   = [];
    alice.on('peer', e => alicePeers.push(e));
    bob.on('peer',   e => bobPeers.push(e));

    await alice.hello(bob.address);

    expect(bobPeers.length).toBeGreaterThanOrEqual(1);
    expect(bobPeers[0].address).toBe(alice.address);
    expect(alicePeers.length).toBeGreaterThanOrEqual(1);
    expect(alicePeers[0].address).toBe(bob.address);
  });

  it('is idempotent — second hello is a no-op', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus);

    await alice.start();
    await bob.start();

    await alice.hello(bob.address);
    const key1 = alice.security.getPeerKey(bob.address);
    await alice.hello(bob.address);  // should be instant no-op
    expect(alice.security.getPeerKey(bob.address)).toBe(key1);
  });

  it('can call skills right after hello', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus);

    bob.register('echo', async ({ parts }) => parts);

    await alice.start();
    await bob.start();

    await alice.hello(bob.address);
    const task   = alice.call(bob.address, 'echo', 'hello world');
    const result = await task.done();

    expect(result.state).toBe('completed');
    const { Parts } = await import('../src/Parts.js');
    expect(Parts.text(result.parts)).toBe('hello world');
  });
});

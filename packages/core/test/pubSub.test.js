import { describe, it, expect, vi } from 'vitest';
import { Agent }                      from '../src/Agent.js';
import { AgentIdentity }              from '../src/identity/AgentIdentity.js';
import { VaultMemory }                from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TextPart, Parts }            from '../src/Parts.js';
import { subscribe, unsubscribe, publish } from '../src/protocol/pubSub.js';

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

async function makeTriple() {
  const bus   = new InternalBus();
  const aId   = await AgentIdentity.generate(new VaultMemory());
  const bId   = await AgentIdentity.generate(new VaultMemory());
  const cId   = await AgentIdentity.generate(new VaultMemory());
  const alice = new Agent({ identity: aId, transport: new InternalTransport(bus, aId.pubKey) });
  const bob   = new Agent({ identity: bId, transport: new InternalTransport(bus, bId.pubKey) });
  const carol = new Agent({ identity: cId, transport: new InternalTransport(bus, cId.pubKey) });
  alice.addPeer(bob.address,   bob.pubKey);
  alice.addPeer(carol.address, carol.pubKey);
  bob.addPeer(alice.address,   alice.pubKey);
  carol.addPeer(alice.address, alice.pubKey);
  await alice.start();
  await bob.start();
  await carol.start();
  return { alice, bob, carol };
}

describe('pubSub subscribe / publish', () => {
  it('subscriber receives published message', async () => {
    const { alice, bob } = await makePair();
    const received = [];

    await subscribe(bob, alice.address, 'news', parts => received.push(parts));
    await new Promise(r => setTimeout(r, 10)); // let subscribe OW land

    await publish(alice, 'news', 'breaking news');
    await new Promise(r => setTimeout(r, 10));

    expect(received).toHaveLength(1);
    expect(Parts.text(received[0])).toBe('breaking news');
  });

  it('publish to unknown topic is silent (no error)', async () => {
    const { alice } = await makePair();
    await expect(publish(alice, 'empty-topic', 'ignored')).resolves.toBeUndefined();
  });

  it('multiple subscribers all receive the message', async () => {
    const { alice, bob, carol } = await makeTriple();
    const bobReceived   = [];
    const carolReceived = [];

    await subscribe(bob,   alice.address, 'events', p => bobReceived.push(p));
    await subscribe(carol, alice.address, 'events', p => carolReceived.push(p));
    await new Promise(r => setTimeout(r, 10));

    await publish(alice, 'events', 'hello all');
    await new Promise(r => setTimeout(r, 10));

    expect(Parts.text(bobReceived[0])).toBe('hello all');
    expect(Parts.text(carolReceived[0])).toBe('hello all');
  });

  it('unsubscribe stops delivery', async () => {
    const { alice, bob } = await makePair();
    const received = [];

    await subscribe(bob, alice.address, 'feed', parts => received.push(parts));
    await new Promise(r => setTimeout(r, 10));

    await publish(alice, 'feed', 'first');
    await new Promise(r => setTimeout(r, 10));

    await unsubscribe(bob, alice.address, 'feed');
    await new Promise(r => setTimeout(r, 10));

    await publish(alice, 'feed', 'second');
    await new Promise(r => setTimeout(r, 10));

    // Only 'first' should have been delivered via the OW publish route.
    // The 'second' publish goes to no subscribers (bob unsubscribed),
    // so alice's publish() call sends nothing.
    // bob.on('publish') will still fire for inbound PBs from alice,
    // but the subscriber map on alice should have been cleaned up.
    // At minimum, the callback must not have been called more than once
    // (because after unsubscribe alice has 0 subscribers for 'feed').
    expect(received).toHaveLength(1);
    expect(Parts.text(received[0])).toBe('first');
  });

  it('different topics do not cross-deliver', async () => {
    const { alice, bob } = await makePair();
    const sportsReceived = [];
    const techReceived   = [];

    await subscribe(bob, alice.address, 'sports', p => sportsReceived.push(p));
    await subscribe(bob, alice.address, 'tech',   p => techReceived.push(p));
    await new Promise(r => setTimeout(r, 10));

    await publish(alice, 'sports', 'goal!');
    await new Promise(r => setTimeout(r, 10));

    expect(sportsReceived).toHaveLength(1);
    expect(techReceived).toHaveLength(0);
  });

  it('Agent.publish() is the same as publish(agent, ...)', async () => {
    const { alice, bob } = await makePair();
    const received = [];

    await subscribe(bob, alice.address, 'ch', p => received.push(p));
    await new Promise(r => setTimeout(r, 10));

    await alice.publish('ch', 'via agent');
    await new Promise(r => setTimeout(r, 10));

    expect(Parts.text(received[0])).toBe('via agent');
  });
});

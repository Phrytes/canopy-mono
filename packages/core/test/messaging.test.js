import { describe, it, expect, vi } from 'vitest';
import { Agent }                      from '../src/Agent.js';
import { AgentIdentity }              from '../src/identity/AgentIdentity.js';
import { VaultMemory }                from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TextPart, DataPart, Parts }  from '../src/Parts.js';

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

describe('Agent.message (one-way)', () => {
  it('delivers a text message to the receiver', async () => {
    const { alice, bob } = await makePair();
    const received = [];
    bob.on('message', msg => received.push(msg));

    await alice.message(bob.address, 'hello world');
    await new Promise(r => setTimeout(r, 10));

    expect(received).toHaveLength(1);
    expect(Parts.text(received[0].parts)).toBe('hello world');
  });

  it('message event includes sender address', async () => {
    const { alice, bob } = await makePair();
    let from;
    bob.on('message', msg => { from = msg.from; });

    await alice.message(bob.address, 'ping');
    await new Promise(r => setTimeout(r, 10));

    expect(from).toBe(alice.address);
  });

  it('delivers multiple messages in order', async () => {
    const { alice, bob } = await makePair();
    const texts = [];
    bob.on('message', msg => texts.push(Parts.text(msg.parts)));

    await alice.message(bob.address, 'one');
    await alice.message(bob.address, 'two');
    await alice.message(bob.address, 'three');
    await new Promise(r => setTimeout(r, 20));

    expect(texts).toEqual(['one', 'two', 'three']);
  });

  it('auto-wraps plain string input into a TextPart', async () => {
    const { alice, bob } = await makePair();
    const parts = await new Promise(res => {
      bob.on('message', msg => res(msg.parts));
      alice.message(bob.address, 'auto-wrapped');
    });
    expect(parts[0].type).toBe('TextPart');
    expect(parts[0].text).toBe('auto-wrapped');
  });

  it('can send DataPart payloads', async () => {
    const { alice, bob } = await makePair();
    const parts = await new Promise(res => {
      bob.on('message', msg => res(msg.parts));
      alice.message(bob.address, [DataPart({ key: 'value' })]);
    });
    expect(Parts.data(parts).key).toBe('value');
  });
});

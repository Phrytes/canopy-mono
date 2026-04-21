import { describe, it, expect, vi } from 'vitest';
import { Agent }                      from '../src/Agent.js';
import { AgentIdentity }              from '../src/identity/AgentIdentity.js';
import { VaultMemory }                from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { SecurityLayer }              from '../src/security/SecurityLayer.js';
import { TextPart, DataPart, Parts }  from '../src/Parts.js';

async function makeAgent(bus, label) {
  const id        = await AgentIdentity.generate(new VaultMemory());
  const transport = new InternalTransport(bus, id.pubKey);
  return new Agent({ identity: id, transport });
}

async function makePair() {
  const bus   = new InternalBus();
  const alice = await makeAgent(bus, 'alice');
  const bob   = await makeAgent(bus, 'bob');

  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);

  await alice.start();
  await bob.start();

  return { alice, bob };
}

// ── Constructor ───────────────────────────────────────────────────────────────

describe('Agent constructor', () => {
  it('throws without identity', async () => {
    const bus  = new InternalBus();
    const id   = await AgentIdentity.generate(new VaultMemory());
    const t    = new InternalTransport(bus, id.pubKey);
    expect(() => new Agent({ transport: t })).toThrow(/identity/);
  });

  it('throws without transport', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    expect(() => new Agent({ identity: id })).toThrow(/transport/);
  });

  it('exposes address, pubKey, identity', async () => {
    const bus = new InternalBus();
    const id  = await AgentIdentity.generate(new VaultMemory());
    const t   = new InternalTransport(bus, id.pubKey);
    const a   = new Agent({ identity: id, transport: t });
    expect(a.address).toBe(id.pubKey);
    expect(a.pubKey).toBe(id.pubKey);
    expect(a.identity).toBe(id);
  });

  it('auto-creates SecurityLayer if not provided', async () => {
    const bus = new InternalBus();
    const id  = await AgentIdentity.generate(new VaultMemory());
    const t   = new InternalTransport(bus, id.pubKey);
    const a   = new Agent({ identity: id, transport: t });
    expect(a.security).toBeInstanceOf(SecurityLayer);
  });
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe('Agent start / stop', () => {
  it('emits start on connect', async () => {
    const bus = new InternalBus();
    const a   = await makeAgent(bus);
    const fn  = vi.fn();
    a.on('start', fn);
    await a.start();
    expect(fn).toHaveBeenCalledOnce();
    await a.stop();
  });

  it('start is idempotent', async () => {
    const bus = new InternalBus();
    const a   = await makeAgent(bus);
    const fn  = vi.fn();
    a.on('start', fn);
    await a.start();
    await a.start(); // second call is no-op
    expect(fn).toHaveBeenCalledOnce();
    await a.stop();
  });

  it('emits stop on disconnect', async () => {
    const bus = new InternalBus();
    const a   = await makeAgent(bus);
    await a.start();
    const fn  = vi.fn();
    a.on('stop', fn);
    await a.stop();
    expect(fn).toHaveBeenCalledOnce();
  });
});

// ── register / skill dispatch ─────────────────────────────────────────────────

describe('Agent.register + invoke (convenience wrapper)', () => {
  it('registers a skill and invokes it', async () => {
    const { alice, bob } = await makePair();

    bob.register('echo', async ({ parts }) => parts);

    const result = await alice.invoke(bob.address, 'echo', [TextPart('hello')]);
    expect(Parts.text(result)).toBe('hello');
  });

  it('handler can return a plain value — auto-wrapped', async () => {
    const { alice, bob } = await makePair();

    bob.register('greet', async () => 'Hi there!');

    const result = await alice.invoke(bob.address, 'greet', []);
    expect(Parts.text(result)).toBe('Hi there!');
  });

  it('handler can return DataPart results', async () => {
    const { alice, bob } = await makePair();

    bob.register('add', async ({ parts }) => {
      const { a, b } = Parts.data(parts);
      return [DataPart({ sum: a + b })];
    });

    const result = await alice.invoke(bob.address, 'add', [DataPart({ a: 3, b: 4 })]);
    expect(Parts.data(result).sum).toBe(7);
  });

  it('unknown skill → invoke() throws', async () => {
    const { alice, bob } = await makePair();
    await expect(alice.invoke(bob.address, 'no-such-skill', [])).rejects.toThrow(/Unknown skill/);
  });

  it('handler exception → invoke() throws', async () => {
    const { alice, bob } = await makePair();
    bob.register('boom', async () => { throw new Error('kaboom'); });
    await expect(alice.invoke(bob.address, 'boom', [])).rejects.toThrow(/kaboom/);
  });

  it('register is chainable', async () => {
    const bus = new InternalBus();
    const a   = await makeAgent(bus);
    expect(a.register('a', async () => []).register('b', async () => [])).toBe(a);
  });
});

// ── message (OW) ─────────────────────────────────────────────────────────────

describe('Agent.message', () => {
  it('delivers a one-way message', async () => {
    const { alice, bob } = await makePair();

    const received = [];
    bob.on('message', msg => received.push(msg));

    await alice.message(bob.address, 'hello world');
    await new Promise(r => setTimeout(r, 10));

    expect(received).toHaveLength(1);
    expect(Parts.text(received[0].parts)).toBe('hello world');
    expect(received[0].from).toBe(alice.address);
  });
});

// ── hello (HI) ───────────────────────────────────────────────────────────────

describe('Agent.hello / peer auto-registration', () => {
  it('hello sends HI and receiver emits peer event (no addPeer needed)', async () => {
    const bus   = new InternalBus();
    const alice = await makeAgent(bus);
    const bob   = await makeAgent(bus);

    await alice.start();
    await bob.start();

    const peerEvents = [];
    bob.on('peer', e => peerEvents.push(e));

    await alice.hello(bob.address);

    // Bob must have received Alice's HI (at least one peer event with Alice's pubKey).
    expect(peerEvents.some(e => e.address === alice.address)).toBe(true);
    expect(peerEvents.find(e => e.address === alice.address)?.pubKey).toBe(alice.pubKey);
  });
});

// ── addPeer ───────────────────────────────────────────────────────────────────

describe('Agent.addPeer', () => {
  it('is chainable', async () => {
    const bus = new InternalBus();
    const a   = await makeAgent(bus);
    expect(a.addPeer('x', 'y')).toBe(a);
  });
});

// ── skill-error event ─────────────────────────────────────────────────────────

describe('skill-error event', () => {
  it('emits skill-error when handler throws', async () => {
    const { alice, bob } = await makePair();

    bob.register('bad', async () => { throw new Error('oops'); });

    const errors = [];
    bob.on('skill-error', e => errors.push(e));

    await alice.invoke(bob.address, 'bad', []).catch(() => {});
    expect(errors).toHaveLength(1);
    expect(errors[0].skillId).toBe('bad');
    expect(errors[0].error.message).toBe('oops');
  });
});

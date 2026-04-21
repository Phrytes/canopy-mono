import { describe, it, expect, vi } from 'vitest';
import { Task }                      from '../src/protocol/Task.js';
import { Agent }                     from '../src/Agent.js';
import { AgentIdentity }             from '../src/identity/AgentIdentity.js';
import { VaultMemory }               from '../src/identity/VaultMemory.js';
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

// ── Task unit tests ───────────────────────────────────────────────────────────

describe('Task state machine', () => {
  it('starts in submitted state', () => {
    const t = new Task({ taskId: 'x', skillId: 'echo' });
    expect(t.state).toBe('submitted');
  });

  it('transitions submitted → working → completed', () => {
    const t = new Task({ taskId: 'x', skillId: 'echo' });
    t._transition('working');
    expect(t.state).toBe('working');
    t._transition('completed', { parts: [TextPart('done')] });
    expect(t.state).toBe('completed');
  });

  it('done() resolves with parts', async () => {
    const t = new Task({ taskId: 'x', skillId: 'echo' });
    t._transition('working');
    setTimeout(() => t._transition('completed', { parts: [TextPart('ok')] }), 5);
    const res = await t.done();
    expect(res.state).toBe('completed');
    expect(Parts.text(res.parts)).toBe('ok');
  });

  it('done() resolves immediately if already completed', async () => {
    const t = new Task({ taskId: 'x', skillId: 'echo' });
    t._transition('working');
    t._transition('completed', { parts: [] });
    const res = await t.done();
    expect(res.state).toBe('completed');
  });

  it('failed transition rejects done()', async () => {
    const t = new Task({ taskId: 'x', skillId: 'echo' });
    t._transition('working');
    setTimeout(() => t._transition('failed', { error: 'boom' }), 5);
    await expect(t.done()).rejects.toThrow('boom');
  });

  it('cancelled transition resolves done()', async () => {
    const t = new Task({ taskId: 'x', skillId: 'echo' });
    t._transition('working');
    setTimeout(() => t._transition('cancelled'), 5);
    const res = await t.done();
    expect(res.state).toBe('cancelled');
  });

  it('emits events', () => {
    const t    = new Task({ taskId: 'x', skillId: 'echo' });
    const done = vi.fn();
    t.on('done', done);
    t._transition('working');
    t._transition('completed', { parts: [] });
    expect(done).toHaveBeenCalledOnce();
  });
});

describe('Task.stream()', () => {
  it('yields pushed chunks', async () => {
    const t      = new Task({ taskId: 'x', skillId: 's' });
    const chunks = [];

    const gen = t.stream();
    t._pushChunk([TextPart('a')]);
    t._pushChunk([TextPart('b')]);
    t._closeStream();

    for await (const c of gen) chunks.push(Parts.text(c));
    expect(chunks).toEqual(['a', 'b']);
  });
});

describe('Task.InputRequired', () => {
  it('is throwable', () => {
    expect(() => {
      throw new Task.InputRequired([TextPart('What is your name?')]);
    }).toThrow('InputRequired');
  });

  it('carries parts', () => {
    try {
      throw new Task.InputRequired([TextPart('Name?')]);
    } catch (e) {
      expect(e.parts[0].text).toBe('Name?');
    }
  });
});

// ── Integration: callSkill + handleTaskRequest ────────────────────────────────

describe('Agent.call (Task integration)', () => {
  it('returns Task and resolves done()', async () => {
    const { alice, bob } = await makePair();
    bob.register('echo', async ({ parts }) => parts);

    const task   = alice.call(bob.address, 'echo', [TextPart('hi')]);
    expect(task).toBeInstanceOf(Task);
    const result = await task.done();
    expect(result.state).toBe('completed');
    expect(Parts.text(result.parts)).toBe('hi');
  });

  it('failed skill transitions to failed', async () => {
    const { alice, bob } = await makePair();
    bob.register('boom', async () => { throw new Error('exploded'); });

    const task = alice.call(bob.address, 'boom', []);
    await expect(task.done()).rejects.toThrow('exploded');
  });

  it('unknown skill → failed with clear message', async () => {
    const { alice, bob } = await makePair();
    const task = alice.call(bob.address, 'no-such', []);
    await expect(task.done()).rejects.toThrow(/Unknown skill/);
  });

  it('streaming generator handler → stream chunks + done', async () => {
    const { alice, bob } = await makePair();

    bob.register('count', async function* () {
      yield [TextPart('one')];
      yield [TextPart('two')];
      yield [TextPart('three')];
    });

    const task   = alice.call(bob.address, 'count', []);
    const chunks = [];
    for await (const c of task.stream()) {
      chunks.push(Parts.text(c));
      // stream() ends when task completes + stream is closed
    }
    expect(chunks).toEqual(['one', 'two', 'three']);
    const res = await task.done();
    expect(res.state).toBe('completed');
  });

  it('Agent.invoke() returns parts directly', async () => {
    const { alice, bob } = await makePair();
    bob.register('add', async ({ parts }) => {
      const { a, b } = Parts.data(parts);
      return [DataPart({ sum: a + b })];
    });

    const result = await alice.invoke(bob.address, 'add', [DataPart({ a: 10, b: 5 })]);
    expect(Parts.data(result).sum).toBe(15);
  });

  it('input-required → send() → completion', async () => {
    const { alice, bob } = await makePair();

    // Handler throws InputRequired on first call (no name), returns on second.
    bob.register('ask-name', async ({ parts }) => {
      const name = Parts.text(parts);
      if (!name) throw new Task.InputRequired([TextPart('What is your name?')]);
      return [TextPart(`Hello, ${name}!`)];
    });

    const task = alice.call(bob.address, 'ask-name', []);

    // Wait for input-required signal.
    const question = await new Promise(res => task.once('input-required', res));
    expect(Parts.text(question)).toBe('What is your name?');

    // Provide input — handler reruns with this as parts.
    await task.send([TextPart('Alice')]);

    const result = await task.done();
    expect(result.state).toBe('completed');
    expect(Parts.text(result.parts)).toBe('Hello, Alice!');
  }, 10_000);
});

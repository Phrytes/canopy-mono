/**
 * streaming.js tests — streamOut, handleStreamChunk, streamBidi
 * All over InternalTransport (no network).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent }          from '../src/Agent.js';
import { AgentIdentity }  from '../src/identity/AgentIdentity.js';
import { VaultMemory }    from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TextPart, DataPart, Parts } from '../src/Parts.js';
import { streamOut, handleStreamChunk } from '../src/protocol/streaming.js';

// ── Fixture ───────────────────────────────────────────────────────────────────

async function makePair() {
  const bus = new InternalBus();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const tA  = new InternalTransport(bus, idA.pubKey);
  const tB  = new InternalTransport(bus, idB.pubKey);
  const alice = new Agent({ identity: idA, transport: tA });
  const bob   = new Agent({ identity: idB, transport: tB });
  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start(); await bob.start();
  return { alice, bob };
}

// ── streamOut ─────────────────────────────────────────────────────────────────

describe('streamOut', () => {
  it('sends stream-chunk OW for each yielded value then stream-end', async () => {
    const { alice, bob } = await makePair();

    const received = [];
    bob.on('message', ({ parts, payload }) => {
      const p = payload ?? {};
      received.push(p.type);
    });

    // Register a listener on bob's transport to capture OW payloads.
    const envelopes = [];
    const origHandler = bob.transport.securityLayer
      ? null : null;
    bob.transport.setReceiveHandler(env => {
      envelopes.push(env);
    });

    async function* gen() { yield [TextPart('a')]; yield [TextPart('b')]; }
    await streamOut(alice, bob.address, 'task-1', gen());

    // Should have received 2 stream-chunk + 1 stream-end OW envelopes.
    const types = envelopes.map(e => e.payload?.type);
    expect(types.filter(t => t === 'stream-chunk')).toHaveLength(2);
    expect(types.filter(t => t === 'stream-end')).toHaveLength(1);
    expect(types.at(-1)).toBe('stream-end');

    await alice.stop(); await bob.stop();
  });

  it('respects AbortSignal — stops mid-stream', async () => {
    const { alice, bob } = await makePair();
    const envelopes = [];
    bob.transport.setReceiveHandler(env => envelopes.push(env));

    const controller = new AbortController();

    async function* gen() {
      for (let i = 0; i < 10; i++) {
        yield [TextPart(`chunk-${i}`)];
        if (i === 2) controller.abort();
      }
    }
    await streamOut(alice, bob.address, 'task-abort', gen(), controller.signal);

    const chunks = envelopes.filter(e => e.payload?.type === 'stream-chunk');
    expect(chunks.length).toBeLessThan(10);

    await alice.stop(); await bob.stop();
  });

  it('empty generator sends only stream-end', async () => {
    const { alice, bob } = await makePair();
    const envelopes = [];
    bob.transport.setReceiveHandler(env => envelopes.push(env));

    async function* empty() {}
    await streamOut(alice, bob.address, 'task-empty', empty());

    expect(envelopes.map(e => e.payload?.type)).toEqual(['stream-end']);

    await alice.stop(); await bob.stop();
  });
});

// ── handleStreamChunk ─────────────────────────────────────────────────────────

describe('handleStreamChunk', () => {
  it('pushes chunk onto task and closes stream on stream-end', async () => {
    const { alice, bob } = await makePair();

    const { Task } = await import('../src/protocol/Task.js');
    const task = new Task({ taskId: 'x', skillId: 'test', state: 'submitted' });
    task._transition('working');
    alice.stateManager.createTask('x', task);

    // Must consume the stream concurrently with producing chunks — for-await
    // suspends until a chunk arrives, so producers must not run after the loop.
    const consumePromise = (async () => {
      const collected = [];
      for await (const c of task.stream()) collected.push(Parts.text(c));
      return collected;
    })();

    // Feed chunks from the other side (simulating inbound OW envelopes).
    const fakeChunk = { payload: { type: 'stream-chunk', taskId: 'x', parts: [TextPart('hello')] } };
    const fakeEnd   = { payload: { type: 'stream-end',   taskId: 'x', parts: [TextPart('world')] } };
    handleStreamChunk(alice, fakeChunk);
    handleStreamChunk(alice, fakeEnd);

    const collected = await consumePromise;
    expect(collected).toContain('hello');
    expect(collected).toContain('world');

    await alice.stop(); await bob.stop();
  });

  it('returns false for non-streaming payloads', async () => {
    const { alice, bob } = await makePair();
    const fakeEnv = { payload: { type: 'ping' } };
    expect(handleStreamChunk(alice, fakeEnv)).toBe(false);
    await alice.stop(); await bob.stop();
  });
});

// ── streamOut + task.stream() integration ─────────────────────────────────────

describe('streamOut + Task.stream() integration via skill', () => {
  it('generator skill streams chunks to caller via task.stream()', async () => {
    const { alice, bob } = await makePair();

    bob.register('count', async function* ({ parts }) {
      const n = parseInt(Parts.text(parts) ?? '3', 10);
      for (let i = 1; i <= n; i++) yield [TextPart(`${i}`)];
    });

    const task    = alice.call(bob.address, 'count', [TextPart('4')]);
    const chunks  = [];
    for await (const c of task.stream()) chunks.push(Parts.text(c));

    expect(chunks).toEqual(['1', '2', '3', '4']);
    expect(task.state).toBe('completed');

    await alice.stop(); await bob.stop();
  });

  it('caller can also await task.done() after streaming', async () => {
    const { alice, bob } = await makePair();
    bob.register('sum', async function* () {
      for (let i = 1; i <= 3; i++) yield [DataPart({ n: i })];
    });

    const task   = alice.call(bob.address, 'sum', []);
    const chunks = [];
    for await (const c of task.stream()) chunks.push(Parts.data(c)?.n);

    const result = await task.done();
    expect(result.state).toBe('completed');
    expect(chunks).toEqual([1, 2, 3]);

    await alice.stop(); await bob.stop();
  });
});

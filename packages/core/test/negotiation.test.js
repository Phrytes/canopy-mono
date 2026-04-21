/**
 * Negotiation tests — multi-round task conversations using InputRequired (IR)
 * and ReplyInput (RI) over InternalTransport.
 *
 * Design notes:
 *  - The inbound handler is RE-INVOKED from scratch each IR round; `parts`
 *    holds only the latest reply. Use `taskId` → Map to accumulate state.
 *  - The next 'input-required' listener MUST be registered BEFORE calling
 *    task.send(), because the IR can arrive as a microtask synchronously
 *    with the sendOneWay resolution (InternalTransport delivers synchronously).
 *
 * Tests:
 *   1. Linear wizard   — fixed 3-question sequence, then result
 *   2. Branching       — answer determines whether an extra round is needed
 *   3. Parallel        — two negotiations in flight; taskId prevents interference
 *   4. Cancel          — caller cancels mid-negotiation; AbortSignal fires
 *   5. Handler error   — wrong password → task fails cleanly
 */
import { describe, it, expect } from 'vitest';
import { Agent }         from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory }   from '../src/identity/VaultMemory.js';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { TextPart, DataPart, Parts } from '../src/Parts.js';
import { Task }          from '../src/protocol/Task.js';

// ── Fixture ────────────────────────────────────────────────────────────────────

async function makePair() {
  const bus = new InternalBus();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const tA  = new InternalTransport(bus, idA.pubKey);
  const tB  = new InternalTransport(bus, idB.pubKey);
  const alice = new Agent({ identity: idA, transport: tA, label: 'alice' });
  const bob   = new Agent({ identity: idB, transport: tB, label: 'bob' });
  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start();
  await bob.start();
  return { alice, bob };
}

/** Wait for the next 'input-required' event on a task. */
const nextIR = task => new Promise(r => task.once('input-required', r));

// ── 1. Linear wizard ──────────────────────────────────────────────────────────

describe('linear wizard (3 rounds)', () => {
  it('name → language → streaming, then returns config', async () => {
    const { alice, bob } = await makePair();
    const state = new Map();

    bob.register('configure', async ({ parts, taskId }) => {
      const s    = state.get(taskId) ?? { step: 0 };
      const text = Parts.text(parts) ?? '';
      switch (s.step) {
        case 0: state.set(taskId, { step: 1 });
                throw new Task.InputRequired([TextPart('What is your name?')]);
        case 1: state.set(taskId, { step: 2, name: text });
                throw new Task.InputRequired([TextPart(`Hi ${text}! Preferred language?`)]);
        case 2: state.set(taskId, { ...s, step: 3, language: text });
                throw new Task.InputRequired([TextPart('Enable streaming? (yes/no)')]);
        default: {
          const f = { ...s, streaming: text.toLowerCase().startsWith('y') };
          state.delete(taskId);
          return [DataPart({ name: f.name, language: f.language, streaming: f.streaming,
                             message: `${f.name} / ${f.language} / streaming=${f.streaming}` })];
        }
      }
    });

    const task = alice.call(bob.address, 'configure', []);

    // Round 1
    const q1 = await nextIR(task);
    expect(Parts.text(q1)).toBe('What is your name?');

    // Register listener for round 2 BEFORE sending, so we don't miss the event.
    const irQ2 = nextIR(task);
    await task.send([TextPart('Alice')]);
    const q2 = await irQ2;
    expect(Parts.text(q2)).toContain('Hi Alice');

    // Round 3
    const irQ3 = nextIR(task);
    await task.send([TextPart('JavaScript')]);
    const q3 = await irQ3;
    expect(Parts.text(q3)).toBe('Enable streaming? (yes/no)');

    await task.send([TextPart('yes')]);
    const result = await task.done();
    expect(result.state).toBe('completed');
    const cfg = Parts.data(result.parts);
    expect(cfg.name).toBe('Alice');
    expect(cfg.language).toBe('JavaScript');
    expect(cfg.streaming).toBe(true);

    await alice.stop(); await bob.stop();
  }, 10_000);
});

// ── 2. Branching negotiation ──────────────────────────────────────────────────

describe('branching negotiation', () => {
  function makeHiringBot() {
    const state = new Map();
    return {
      state,
      handler: async ({ parts, taskId }) => {
        const s    = state.get(taskId) ?? { step: 0 };
        const text = Parts.text(parts) ?? '';
        switch (s.step) {
          case 0: state.set(taskId, { step: 1 });
                  throw new Task.InputRequired([TextPart('Name?')]);
          case 1: state.set(taskId, { step: 2, name: text });
                  throw new Task.InputRequired([TextPart('Years of experience?')]);
          case 2: {
            const years = parseInt(text, 10) || 0;
            if (years < 2) {
              state.set(taskId, { ...s, step: 3, years });
              throw new Task.InputRequired([TextPart('Please provide a reference.')]);
            }
            state.delete(taskId);
            return [DataPart({ accepted: true, level: 'senior', rounds: 2 })];
          }
          default: {
            state.delete(taskId);
            return [DataPart({ accepted: true, level: 'junior', rounds: 3, reference: text })];
          }
        }
      },
    };
  }

  it('junior applicant (< 2 yrs) takes 3 rounds including reference check', async () => {
    const { alice, bob } = await makePair();
    bob.register('apply', makeHiringBot().handler);

    const task = alice.call(bob.address, 'apply', []);

    const q1 = await nextIR(task);
    expect(Parts.text(q1)).toBe('Name?');

    const irQ2 = nextIR(task);
    await task.send([TextPart('Junior Dev')]);
    const q2 = await irQ2;
    expect(Parts.text(q2)).toBe('Years of experience?');

    const irQ3 = nextIR(task);
    await task.send([TextPart('1')]);
    const q3 = await irQ3;
    expect(Parts.text(q3)).toBe('Please provide a reference.');

    await task.send([TextPart('Carol <carol@example.com>')]);
    const result = await task.done();
    const d = Parts.data(result.parts);
    expect(d.accepted).toBe(true);
    expect(d.level).toBe('junior');
    expect(d.rounds).toBe(3);

    await alice.stop(); await bob.stop();
  }, 10_000);

  it('senior applicant (>= 2 yrs) completes in 2 rounds, no reference', async () => {
    const { alice, bob } = await makePair();
    bob.register('apply', makeHiringBot().handler);

    const task = alice.call(bob.address, 'apply', []);

    const q1 = await nextIR(task);
    expect(Parts.text(q1)).toBe('Name?');

    const irQ2 = nextIR(task);
    await task.send([TextPart('Senior Dev')]);
    await irQ2; // Years of experience?

    await task.send([TextPart('5')]);
    const result = await task.done();
    expect(Parts.data(result.parts).level).toBe('senior');
    expect(Parts.data(result.parts).rounds).toBe(2);

    await alice.stop(); await bob.stop();
  }, 10_000);
});

// ── 3. Parallel negotiations ───────────────────────────────────────────────────

describe('parallel negotiations', () => {
  it('two concurrent tasks accumulate independent state via taskId', async () => {
    const { alice, bob } = await makePair();
    const state = new Map();

    bob.register('quote', async ({ parts, taskId }) => {
      const s    = state.get(taskId) ?? { step: 0 };
      const text = Parts.text(parts) ?? '';
      switch (s.step) {
        case 0: state.set(taskId, { step: 1 });
                throw new Task.InputRequired([TextPart('Item?')]);
        case 1: state.set(taskId, { step: 2, item: text });
                throw new Task.InputRequired([TextPart(`Quantity for "${text}"?`)]);
        default: {
          const qty = parseInt(text, 10) || 1;
          state.delete(taskId);
          return [DataPart({ item: s.item, qty, total: +(qty * 9.99).toFixed(2) })];
        }
      }
    });

    const taskA = alice.call(bob.address, 'quote', []);
    const taskB = alice.call(bob.address, 'quote', []);

    // Both tasks ask "Item?" simultaneously.
    const [irA1, irB1] = await Promise.all([nextIR(taskA), nextIR(taskB)]);
    expect(Parts.text(irA1)).toBe('Item?');
    expect(Parts.text(irB1)).toBe('Item?');

    // Pre-register round-2 listeners before sending replies.
    const irA2p = nextIR(taskA);
    const irB2p = nextIR(taskB);
    await taskA.send([TextPart('pizza')]);
    await taskB.send([TextPart('sushi')]);
    const [irA2, irB2] = await Promise.all([irA2p, irB2p]);

    expect(Parts.text(irA2)).toContain('pizza');
    expect(Parts.text(irB2)).toContain('sushi');

    await taskA.send([TextPart('3')]);
    await taskB.send([TextPart('2')]);

    const [rA, rB] = await Promise.all([taskA.done(), taskB.done()]);
    expect(Parts.data(rA.parts).item).toBe('pizza');
    expect(Parts.data(rA.parts).qty).toBe(3);
    expect(Parts.data(rB.parts).item).toBe('sushi');
    expect(Parts.data(rB.parts).qty).toBe(2);

    await alice.stop(); await bob.stop();
  }, 10_000);
});

// ── 4. Caller cancels mid-negotiation ────────────────────────────────────────

describe('cancel during negotiation', () => {
  it('task goes to cancelled; AbortSignal fires in handler', async () => {
    const { alice, bob } = await makePair();
    const state = new Map();
    let handlerSawAbort = false;

    bob.register('long-form', async ({ parts, taskId, signal }) => {
      const s = state.get(taskId) ?? { step: 0 };
      if (s.step === 0) {
        state.set(taskId, { step: 1 });
        throw new Task.InputRequired([TextPart('Step 1 of many — give an answer:')]);
      }
      // Simulate slow work that the caller will cancel.
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          handlerSawAbort = true;
          reject(new DOMException('Aborted', 'AbortError'));
        });
        setTimeout(() => reject(new Error('timeout')), 10_000);
      });
    });

    const task = alice.call(bob.address, 'long-form', []);
    await nextIR(task);
    await task.send([TextPart('my answer')]);
    await new Promise(r => setTimeout(r, 50));
    await task.cancel();

    expect(task.state).toBe('cancelled');
    await new Promise(r => setTimeout(r, 100));
    expect(handlerSawAbort).toBe(true);

    await alice.stop(); await bob.stop();
  }, 10_000);
});

// ── 5. Handler error mid-negotiation ─────────────────────────────────────────

describe('handler error after IR', () => {
  it('wrong password → task.done() rejects, state = failed', async () => {
    const { alice, bob } = await makePair();
    const state = new Map();

    bob.register('auth', async ({ parts, taskId }) => {
      const s    = state.get(taskId) ?? { step: 0 };
      const text = Parts.text(parts) ?? '';
      if (s.step === 0) {
        state.set(taskId, { step: 1 });
        throw new Task.InputRequired([TextPart('Password?')]);
      }
      state.delete(taskId);
      if (text !== 'hunter2') throw new Error('Access denied');
      return [TextPart('Welcome!')];
    });

    const task = alice.call(bob.address, 'auth', []);
    await nextIR(task);
    await task.send([TextPart('wrong-password')]);
    await expect(task.done()).rejects.toThrow();
    expect(task.state).toBe('failed');

    await alice.stop(); await bob.stop();
  }, 10_000);

  it('correct password → completes successfully', async () => {
    const { alice, bob } = await makePair();
    const state = new Map();

    bob.register('auth', async ({ parts, taskId }) => {
      const s    = state.get(taskId) ?? { step: 0 };
      const text = Parts.text(parts) ?? '';
      if (s.step === 0) { state.set(taskId, { step: 1 }); throw new Task.InputRequired([TextPart('Password?')]); }
      state.delete(taskId);
      if (text !== 'hunter2') throw new Error('Access denied');
      return [TextPart('Welcome!')];
    });

    const task = alice.call(bob.address, 'auth', []);
    await nextIR(task);
    await task.send([TextPart('hunter2')]);
    const result = await task.done();
    expect(result.state).toBe('completed');
    expect(Parts.text(result.parts)).toBe('Welcome!');

    await alice.stop(); await bob.stop();
  }, 10_000);
});

/**
 * T.4 — Protocol scenarios — input-required multi-turn.
 *
 * Story: Alice invokes Bob's `prompt-then-respond` skill over A2A;
 * Bob returns input-required; Alice supplies input; Bob completes.
 * Cancel-mid-prompt variant included.
 *
 * NOTE on "over A2A": the harness's InternalTransport already exercises
 * the same `taskExchange.js` request/IR/RI/RS path that A2A uses; the
 * RQ → IR → RI → RS sequence is wire-identical regardless of transport.
 * A real A2A external-interop scenario lives in T.6 (Q-Test.5 dep).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Task, TextPart, Parts } from '@onderling/core';
import { Lab }                   from '../../../src/_harness/index.js';

describe('protocol — input-required multi-turn', () => {
  let lab;
  afterEach(async () => { if (lab) { await lab.teardown(); lab = null; } });

  it('Bob asks for input, Alice supplies it, Bob completes', async () => {
    lab = await Lab.boot({ agents: ['alice', 'bob'] });

    // Bob's skill: first call → InputRequired; resumed → return greeting.
    let invocations = 0;
    lab.agent('bob').register('prompt-then-respond', async ({ parts }) => {
      invocations += 1;
      if (invocations === 1) {
        // No name yet — ask for one.
        throw new Task.InputRequired([TextPart('What is your name?')]);
      }
      const name = Parts.text(parts) || 'stranger';
      return [TextPart(`hello ${name}`)];
    });

    await lab.agent('alice').hello(lab.agent('bob').address);

    // Alice fires the call.  We use `call()` (not invoke()) so we hold the
    // Task and can react to the input-required event.
    const task = lab.invokeStream('alice', 'bob', 'prompt-then-respond');

    // Wait for input-required, supply the name.
    const promptParts = await new Promise((resolve) => {
      task.on('input-required', resolve);
    });
    expect(Parts.text(promptParts)).toBe('What is your name?');

    await task.send([TextPart('Alice')]);

    const result = await task.done();
    expect(result.state).toBe('completed');
    expect(Parts.text(result.parts)).toBe('hello Alice');
    expect(invocations).toBe(2);
  }, 5_000);

  it('cancel-mid-prompt: Alice cancels while Bob waits for input', async () => {
    lab = await Lab.boot({ agents: ['alice', 'bob'] });

    let bobResolvedNormally = false;
    let invocations = 0;
    lab.agent('bob').register('prompt-then-respond', async ({ parts }) => {
      invocations += 1;
      if (invocations === 1) {
        throw new Task.InputRequired([TextPart('What is your name?')]);
      }
      bobResolvedNormally = true;
      return [TextPart(`hello ${Parts.text(parts)}`)];
    });

    await lab.agent('alice').hello(lab.agent('bob').address);

    const task = lab.invokeStream('alice', 'bob', 'prompt-then-respond');

    // Wait for the prompt, then cancel without sending input.
    await new Promise((resolve) => task.on('input-required', resolve));
    await task.cancel();

    // The task transitions to cancelled (Task.cancel() runs locally first,
    // then sends the OW; the synchronous transition is what we assert).
    const final = await task.done();
    expect(final.state).toBe('cancelled');

    // Wait for Bob's IR loop to process the cancel OW and unwind the
    // pending wait.  After this grace window Bob must NOT have re-entered
    // the handler with new input — the cancel killed the loop.
    await new Promise((r) => setTimeout(r, 100));
    expect(invocations).toBe(1);
    expect(bobResolvedNormally).toBe(false);
  }, 5_000);
});

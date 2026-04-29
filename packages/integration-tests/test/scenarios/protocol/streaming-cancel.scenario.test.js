/**
 * T.4 — Protocol scenarios — streaming + cancel.
 *
 * Story: Alice invokes Bob's `count-to-100` streaming skill; after 10
 * chunks Alice cancels; Bob's stream stops within 200ms; subsequent
 * chunks are not delivered to Alice.
 *
 * Verifies (DoD bullet):
 *   - Cancellation propagates to Bob's handler — Bob's side observes the
 *     abort signal and stops emitting before reaching chunk 100.
 *
 * Real timers: streaming uses microtask-driven Promise.resolve gaps to let
 * the OW envelope cycle through the InternalBus.  Fake timers would mask
 * the cancel propagation latency we're trying to measure.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextPart, Parts } from '@canopy/core';
import { Lab }             from '../../../src/_harness/index.js';

describe('protocol — streaming + cancel propagation', () => {
  let lab;
  afterEach(async () => { if (lab) { await lab.teardown(); lab = null; } });

  it('Bob observes the abort signal and stops streaming after Alice cancels', async () => {
    lab = await Lab.boot({ agents: ['alice', 'bob'] });

    // Bob registers a streaming `count-to-100` skill.  The async generator
    // checks ctx.signal.aborted between chunks; we record the highest
    // chunk index that was sent so we can assert the cancel propagated.
    const TOTAL  = 100;
    let highestEmitted = -1;
    let abortObserved  = false;

    lab.agent('bob').register('count-to-100', async function* (ctx) {
      for (let i = 0; i < TOTAL; i++) {
        if (ctx.signal?.aborted) { abortObserved = true; return; }
        highestEmitted = i;
        yield [TextPart(`chunk-${i}`)];
        // Yield to the event loop so the OW reaches Alice and her cancel
        // (sent OW) has a chance to round-trip back.
        await new Promise((r) => setTimeout(r, 1));
      }
    });

    await lab.agent('alice').hello(lab.agent('bob').address);

    // Kick off the stream.  `lab.invokeStream` returns a Task immediately.
    const task = lab.invokeStream('alice', 'bob', 'count-to-100');

    // Consume Alice's stream until we've seen 10 chunks.
    const aliceChunks = [];
    let cancelledAfter = -1;
    for await (const chunk of task.stream()) {
      aliceChunks.push(Parts.text(chunk));
      if (aliceChunks.length === 10) {
        cancelledAfter = highestEmitted;
        const t0 = Date.now();
        await task.cancel();
        // Allow Bob's handler up to 200ms to notice and stop.
        await new Promise((r) => setTimeout(r, 200));
        // Record the high-water mark right after the 200ms grace window.
        const observedAt200ms = highestEmitted;

        // DoD: Bob's handler observed the abort signal AND stopped well
        // before reaching the natural end (TOTAL = 100).
        expect(abortObserved).toBe(true);
        expect(observedAt200ms).toBeLessThan(TOTAL - 1);
        // Sanity: at most a few extra chunks slipped out between the
        // cancel and Bob's next signal-aborted check.
        expect(observedAt200ms - cancelledAfter).toBeLessThanOrEqual(20);
        // Sanity: the 200ms wall-clock budget actually held.
        expect(Date.now() - t0).toBeLessThan(500);
        break;
      }
    }

    // Alice received exactly 10 chunks in numeric order before cancelling.
    expect(aliceChunks).toHaveLength(10);
    expect(aliceChunks[0]).toBe('chunk-0');
    expect(aliceChunks[9]).toBe('chunk-9');

    // Give the system one more turn to ensure no late chunks land.
    await new Promise((r) => setTimeout(r, 50));
    // Subsequent chunks must not have been queued onto Alice's task —
    // her stream() generator already exited (we broke out above).
    // We re-acquire the task's terminal state to double-check.
    const final = await task.done();
    expect(['cancelled', 'completed']).toContain(final.state);
    expect(final.state).toBe('cancelled');
  }, 5_000);
});

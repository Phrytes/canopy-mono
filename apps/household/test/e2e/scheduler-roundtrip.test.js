/**
 * scheduler-roundtrip.test.js — Phase 4 e2e.
 *
 * Wires Scheduler + HouseholdAgent + InMemoryStore + MockBridge.
 * Verifies:
 *   - Adding an item arms a NudgeTimer
 *   - Marking complete cancels the NudgeTimer
 *   - Letting the NudgeTimer mature posts a "what got done?" message
 *     via the bridge
 *   - Force-firing the daily digest posts a digest message
 *
 * Uses vi.useFakeTimers() so the 1-hour delay is deterministic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { HouseholdAgent } from '../../src/HouseholdAgent.js';
import { MockBridge }     from '../../src/bridges/MockBridge.js';
import { InMemoryStore }  from '../../src/storage/InMemoryStore.js';
import { Scheduler }      from '../../src/scheduler/Scheduler.js';

const ALICE = 'https://id.example.org/alice#me';

function makeMsg(text) {
  return {
    bridgeId: 'mock', chatId: 'chat-1',
    messageId: `msg-${Math.random().toString(36).slice(2, 8)}`,
    sender: { displayName: 'alice', bridgeUid: 'alice', webid: ALICE },
    text, replyTo: null, isAddressed: true,
  };
}

describe('Phase 4 e2e — Scheduler + HouseholdAgent', () => {
  /** @type {InMemoryStore} */ let store;
  /** @type {MockBridge} */    let bridge;
  /** @type {Scheduler} */     let scheduler;
  /** @type {HouseholdAgent} */ let agent;

  beforeEach(async () => {
    vi.useFakeTimers();
    store    = new InMemoryStore();
    bridge   = new MockBridge();
    // Build the agent with a placeholder; rebind the scheduler's
    // `postToChat` to `agent.dispatch` after the agent exists.  We
    // avoid the chicken-and-egg by constructing scheduler with a thunk.
    /** @type {HouseholdAgent} */
    let agentRef;
    scheduler = new Scheduler({
      store,
      postToChat:    (chatId, replies) => agentRef.dispatch(chatId, replies),
      primaryChatId: 'chat-1',
      household:     { tz: 'UTC', nudgeDelayMs: 60 * 60 * 1000, digestAtLocal: '20:00' },
    });
    agent = new HouseholdAgent({ store, bridges: [bridge], scheduler });
    agentRef = agent;
    await agent.start();   // registers the handler on the bridge
    scheduler.start();
  });

  afterEach(async () => {
    await scheduler.stop();
    vi.useRealTimers();
  });

  // Note on MockBridge semantics: `emit()` invokes the agent's
  // handler and returns its Reply directly — it does NOT record into
  // bridge's queue.  Only `bridge.sendReply()` (called by
  // `agent.dispatch()` from the scheduler) appends to the queue.  So
  // `bridge.size()` measures *agent-initiated* posts (nudges +
  // digests), not the immediate replies to user commands.

  it('adding an item arms a 1-hour nudge that posts via the bridge after maturity', async () => {
    await bridge.emit(makeMsg('add shopping bread'));
    // Halfway: nothing should have been posted by the scheduler yet.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(bridge.size()).toBe(0);
    // Mature: nudge fires → scheduler dispatches → bridge.sendReply called.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 100);
    expect(bridge.size()).toBe(1);
    const sent = bridge.pop();
    expect(sent.text).toMatch(/bread/i);
  });

  it('marking complete cancels the pending nudge', async () => {
    await bridge.emit(makeMsg('add shopping bread'));
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    await bridge.emit(makeMsg('done bread'));
    // Past the original 1 h — nothing should fire.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    expect(bridge.size()).toBe(0);
  });

  it('a single nudge fires for the chat covering all pending items (drained set)', async () => {
    await bridge.emit(makeMsg('add shopping bread'));
    await bridge.emit(makeMsg('add shopping milk'));
    await bridge.emit(makeMsg('add shopping eggs'));
    // The most recent `schedule` resets the timer; nudge matures 1 h
    // after the LAST add.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    expect(bridge.size()).toBe(1);
    const sent = bridge.pop();
    // The single nudge's text references at least one of the pending items.
    expect(sent.text).toMatch(/bread|milk|eggs/i);
  });

  it('daily digest fires via fireDigestNow()', async () => {
    await bridge.emit(makeMsg('add shopping coffee'));
    await bridge.emit(makeMsg('add errand fix the bike'));
    // Drain whatever the nudge would have posted later, by completing
    // the items so the scheduler's pending set empties.
    await scheduler.fireDigestNow();
    const sent = bridge.pop();
    expect(sent).toBeTruthy();
    expect(sent.text).toMatch(/digest/i);
  });

  it('agent works without a scheduler attached (back-compat)', async () => {
    // Replace the wired-up agent + bridge with a fresh pair that has no scheduler.
    await agent.stop();
    await scheduler.stop();
    const freshBridge = new MockBridge();
    const noSchedAgent = new HouseholdAgent({ store, bridges: [freshBridge] });
    await noSchedAgent.start();
    const reply = await freshBridge.emit(makeMsg('add shopping bread'));
    expect(reply.replies[0].text).toMatch(/added/i);
    // No scheduler ⇒ no nudge fires.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(freshBridge.size()).toBe(0);
    await noSchedAgent.stop();
  });
});

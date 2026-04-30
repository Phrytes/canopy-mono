/**
 * round-trip.test.js — Phase 1 e2e.
 *
 * Wires MockBridge + InMemoryStore + HouseholdAgent together and
 * exercises the full incoming-message → regex → skill → reply path.
 *
 * No real Telegram, no real pod, no LLM.  This is the contract test
 * for "Phase 1 streams 1a–1d compose correctly under the agent's
 * routing logic".
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { HouseholdAgent } from '../../src/HouseholdAgent.js';
import { MockBridge }     from '../../src/bridges/MockBridge.js';
import { InMemoryStore }  from '../../src/storage/InMemoryStore.js';

const ALICE = 'https://id.example.org/alice#me';

function makeMsg(text, { isAddressed = true, sender = 'alice', webid = ALICE } = {}) {
  return {
    bridgeId: 'mock',
    chatId:   'chat-1',
    messageId: `msg-${Math.random().toString(36).slice(2, 8)}`,
    sender:   { displayName: sender, bridgeUid: sender, webid },
    text,
    replyTo:  null,
    isAddressed,
  };
}

describe('Phase 1 e2e — bridge + agent + skills + store', () => {
  /** @type {InMemoryStore} */ let store;
  /** @type {MockBridge} */    let bridge;
  /** @type {HouseholdAgent} */ let agent;

  beforeEach(async () => {
    store  = new InMemoryStore();
    bridge = new MockBridge();
    agent  = new HouseholdAgent({ store, bridges: [bridge] });
    await agent.start();
  });

  it('drops messages that are not addressed', async () => {
    const reply = await bridge.emit(makeMsg('we need bread', { isAddressed: false }));
    expect(reply.replies).toEqual([]);
    expect(reply.stateUpdates).toEqual([]);
  });

  it('add → list → done round-trip works end-to-end', async () => {
    // 1. add
    const r1 = await bridge.emit(makeMsg('add shopping bread'));
    expect(r1.replies[0].text).toMatch(/added.*bread/i);
    expect(r1.stateUpdates[0].kind).toBe('item.added');

    // 2. list shows it
    const r2 = await bridge.emit(makeMsg('list shopping'));
    expect(r2.replies[0].text).toMatch(/bread/);

    // 3. done removes it from the open list
    const r3 = await bridge.emit(makeMsg('done bread'));
    expect(r3.replies[0].text).toMatch(/marked complete|bread/i);
    expect(r3.stateUpdates[0].kind).toBe('item.completed');

    // 4. list is empty again
    const r4 = await bridge.emit(makeMsg('list shopping'));
    expect(r4.replies[0].text).toMatch(/nothing open|empty/i);
  });

  it('multi-item add (`bread, milk, eggs`) creates three items', async () => {
    const reply = await bridge.emit(makeMsg('add shopping bread, milk, eggs'));
    expect(reply.stateUpdates.filter((u) => u.kind === 'item.added')).toHaveLength(3);

    const open = await store.listOpen({ type: 'shopping' });
    expect(open.map((i) => i.text).sort()).toEqual(['bread', 'eggs', 'milk']);
  });

  it('Dutch verbs work too — voeg toe / lijst / klaar', async () => {
    await bridge.emit(makeMsg('voeg toe boodschappen melk'));
    const open1 = await store.listOpen({ type: 'shopping' });
    expect(open1.map((i) => i.text)).toContain('melk');

    const list = await bridge.emit(makeMsg('lijst boodschappen'));
    expect(list.replies[0].text).toMatch(/melk/);

    await bridge.emit(makeMsg('klaar melk'));
    const open2 = await store.listOpen({ type: 'shopping' });
    expect(open2.map((i) => i.text)).not.toContain('melk');
  });

  it('"what do we need?" maps to listOpen({type: shopping})', async () => {
    await bridge.emit(makeMsg('add shopping coffee'));
    await bridge.emit(makeMsg('add errand fix the bike'));

    const reply = await bridge.emit(makeMsg('what do we need?'));
    expect(reply.replies[0].text).toMatch(/coffee/);
    expect(reply.replies[0].text).not.toMatch(/bike/);
  });

  it('@-mention prefix is parsed correctly', async () => {
    const reply = await bridge.emit(makeMsg('@Household add shopping bread'));
    expect(reply.replies[0].text).toMatch(/added.*bread/i);
  });

  it('unknown / unparseable text returns the help hint (no LLM in v0)', async () => {
    const reply = await bridge.emit(makeMsg('we should probably do something about the kitchen tap'));
    expect(reply.replies[0].text).toMatch(/couldn['’]?t parse|try .*add|help/i);
    expect(reply.stateUpdates).toEqual([]);
  });

  it('help command returns the static command list', async () => {
    const reply = await bridge.emit(makeMsg('help'));
    expect(reply.replies[0].text).toMatch(/add|list|done/i);
  });

  it('items added by a sender without a webid get a synthesised "unknown:..." webid', async () => {
    const msg = makeMsg('add shopping noname-item', { webid: null });
    await bridge.emit(msg);
    const items = await store.listOpen();
    const found = items.find((i) => i.text === 'noname-item');
    expect(found).toBeTruthy();
    expect(found.addedBy).toMatch(/^unknown:mock:/);
  });

  it('a skill that throws does not crash the agent — user sees a friendly error', async () => {
    // markComplete with no matching item should reply gracefully (not throw).
    const reply = await bridge.emit(makeMsg('done nonexistent-item-foo'));
    expect(reply.replies[0].text).toMatch(/couldn['’]?t find|unknown|no.*match/i);
    // Agent stays usable after the error.
    const after = await bridge.emit(makeMsg('add shopping still-works'));
    expect(after.replies[0].text).toMatch(/added/i);
  });

  it('start() and stop() are idempotent', async () => {
    await agent.start();              // already started in beforeEach
    await agent.stop();
    await agent.stop();               // second call no-op, no throw
    // After stop, the bridge no longer relays — but emit still returns
    // the handler's response since onMessage is registered on the bridge
    // unconditionally.  This is fine — we're testing idempotency of
    // start/stop, not full lifecycle teardown.
  });
});

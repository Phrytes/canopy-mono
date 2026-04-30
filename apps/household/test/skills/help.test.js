import { describe, it, expect } from 'vitest';
import { help } from '../../src/skills/help.js';
import { InMemoryStore } from '../../src/storage/InMemoryStore.js';

function makeCtx() {
  return {
    store: new InMemoryStore(),
    chatId: 'chat-test',
    senderWebid: 'webid:alice',
    bridgeId: 'mock',
  };
}

describe('skills/help', () => {
  it('returns a single reply with no stateUpdates', async () => {
    const reply = await help({}, makeCtx());
    expect(reply.replies).toHaveLength(1);
    expect(reply.stateUpdates).toEqual([]);
  });

  it('mentions the core verbs in English', async () => {
    const reply = await help({}, makeCtx());
    const text = reply.replies[0].text.toLowerCase();
    expect(text).toContain('add');
    expect(text).toContain('list');
    expect(text).toContain('done');
    expect(text).toContain('remove');
    expect(text).toContain('help');
  });

  it('mentions the Dutch verbs', async () => {
    const reply = await help({}, makeCtx());
    const text = reply.replies[0].text.toLowerCase();
    expect(text).toContain('voeg toe');
    expect(text).toContain('klaar');
    expect(text).toContain('verwijder');
    expect(text).toContain('hulp');
  });

  it('lists the four item types', async () => {
    const reply = await help({}, makeCtx());
    const text = reply.replies[0].text.toLowerCase();
    expect(text).toContain('shopping');
    expect(text).toContain('errand');
    expect(text).toContain('repair');
    expect(text).toContain('schedule');
  });
});

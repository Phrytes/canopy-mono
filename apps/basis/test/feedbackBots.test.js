// Added feedback bots — invite parsing + persisted registry (cluster J: add-by-link, no pre-seeding).
import { describe, it, expect } from 'vitest';
import { feedbackBotFromInput, feedbackBotId, createFeedbackBotStore } from '../src/v2/feedbackBots.js';

function memStore() {
  const m = new Map();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, String(v)); } };
}

describe('feedbackBots', () => {
  it('feedbackBotFromInput parses a portal invite URL → a feedback-bot descriptor', () => {
    const bot = feedbackBotFromInput('http://localhost:5173/?projectId=demo-walkthrough&code=abc-123', { activationUrl: 'http://h:8788' });
    expect(bot).toMatchObject({
      id: feedbackBotId('demo-walkthrough'), kind: 'agent', projectId: 'demo-walkthrough', code: 'abc-123', activationUrl: 'http://h:8788',
    });
    expect(bot.name).toContain('demo-walkthrough');
  });

  it('returns null for a non-invite input (so add-a-bot falls through to the normal peer flow)', () => {
    expect(feedbackBotFromInput('https://example.org/agent-card.json')).toBe(null);
    expect(feedbackBotFromInput('just some text')).toBe(null);
  });

  it('the store adds (de-duped by id), lists, gets, and removes — persisted', async () => {
    const store = createFeedbackBotStore(memStore());
    const bot = feedbackBotFromInput('?projectId=p1&code=c1');
    await store.add(bot);
    await store.add({ ...bot, code: 'c2' });           // same id → replaces, not duplicates
    expect((await store.list()).length).toBe(1);
    expect((await store.get(feedbackBotId('p1'))).code).toBe('c2');
    await store.remove(feedbackBotId('p1'));
    expect(await store.list()).toEqual([]);
  });
});

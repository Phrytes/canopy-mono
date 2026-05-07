/**
 * HouseholdAgentFreeform — V2 prototype tests.
 *
 * Validates the additive coexistence: the new agent works in
 * isolation, doesn't break the legacy `HouseholdAgent`, and routes
 * slash commands deterministically while letting plain text fall
 * through to the LLM.
 *
 * Uses InMemoryBridge + LlmClient(mockProvider) for fast,
 * deterministic tests — no Ollama required.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { LlmClient, mockProvider } from '@canopy/llm-client';
import { InMemoryBridge }           from '@canopy/chat-agent';

import { HouseholdAgentFreeform } from '../src/HouseholdAgentFreeform.js';

function buildAgent({ responses = [] } = {}) {
  const bridge = new InMemoryBridge({ id: 'test' });
  const llm    = new LlmClient({
    provider: mockProvider({
      responses: responses.length > 0 ? responses : [{ replyText: 'ok' }],
    }),
  });
  const agent = new HouseholdAgentFreeform({ bridges: [bridge], llm });
  return { agent, bridge, llm };
}

describe('HouseholdAgentFreeform — construction', () => {
  it('rejects without bridges', () => {
    expect(() => new HouseholdAgentFreeform({ llm: {} })).toThrow(/bridges/);
  });

  it('rejects without llm', () => {
    const bridge = new InMemoryBridge({ id: 'x' });
    expect(() => new HouseholdAgentFreeform({ bridges: [bridge] })).toThrow(/llm/);
  });

  it('builds an in-memory store by default', () => {
    const { agent } = buildAgent();
    expect(agent.store.lists).toBeInstanceOf(Map);
    expect(agent.store.lists.size).toBe(0);
  });

  it('rejects persist=true without listsPath', () => {
    const bridge = new InMemoryBridge({ id: 'x' });
    const llm    = new LlmClient({ provider: mockProvider({ responses: [{ replyText: 'ok' }] }) });
    expect(
      () => new HouseholdAgentFreeform({ bridges: [bridge], llm, persist: true }),
    ).toThrow(/listsPath/);
  });

  it('exposes a ChatAgent on .chatAgent', () => {
    const { agent } = buildAgent();
    expect(agent.chatAgent).toBeTruthy();
    expect(typeof agent.chatAgent.start).toBe('function');
  });
});

describe('HouseholdAgentFreeform — start / stop', () => {
  it('start + stop are idempotent', async () => {
    const { agent } = buildAgent();
    await agent.start();
    await agent.start();
    await agent.stop();
    await agent.stop();
  });
});

describe('HouseholdAgentFreeform — slash command routing (deterministic, no LLM)', () => {
  let agent, bridge, llm;
  beforeEach(() => {
    ({ agent, bridge, llm } = buildAgent());
  });

  it('/add adds items to the store', async () => {
    await agent.start();
    await bridge.simulateIncoming({ text: '/add boodschappen brood, melk' });
    expect(agent.store.lists.get('boodschappen')).toEqual(['brood', 'melk']);
  });

  it('/add reply confirms the items added', async () => {
    await agent.start();
    bridge.clearOutbox();
    await bridge.simulateIncoming({ text: '/add boodschappen brood' });
    expect(bridge.outbox[0].text).toContain('Toegevoegd');
    expect(bridge.outbox[0].text).toContain('brood');
  });

  it('/show renders text + buttons', async () => {
    agent.store.addItem('boodschappen', 'appels');
    agent.store.addItem('boodschappen', 'peren');
    await agent.start();
    bridge.clearOutbox();
    await bridge.simulateIncoming({ text: '/show boodschappen' });
    const reply = bridge.outbox[0];
    expect(reply.text).toContain('boodschappen');
    expect(Array.isArray(reply.buttons)).toBe(true);
    expect(reply.buttons).toHaveLength(2);
  });

  it('/remove removes the item', async () => {
    agent.store.addItem('boodschappen', 'brood');
    agent.store.addItem('boodschappen', 'melk');
    await agent.start();
    await bridge.simulateIncoming({ text: '/remove boodschappen brood' });
    expect(agent.store.lists.get('boodschappen')).toEqual(['melk']);
  });

  it('/done is an alias for /remove', async () => {
    agent.store.addItem('boodschappen', 'brood');
    await agent.start();
    await bridge.simulateIncoming({ text: '/done boodschappen brood' });
    expect(agent.store.lists.has('boodschappen')).toBe(false);  // last item removed
  });

  it('/lists shows known list summary', async () => {
    agent.store.addItem('boodschappen', 'brood');
    agent.store.addItem('klusjes', 'timmeren');
    await agent.start();
    bridge.clearOutbox();
    await bridge.simulateIncoming({ text: '/lists' });
    expect(bridge.outbox[0].text).toContain('boodschappen');
    expect(bridge.outbox[0].text).toContain('klusjes');
  });

  it('/help replies with command summary', async () => {
    await agent.start();
    bridge.clearOutbox();
    await bridge.simulateIncoming({ text: '/help' });
    expect(bridge.outbox[0].text).toMatch(/\/add/);
    expect(bridge.outbox[0].text).toMatch(/\/show/);
  });

  it('slash commands DO NOT invoke the LLM', async () => {
    // Provider that throws — confirms no invoke happened.
    const throwingLlm = new LlmClient({
      provider: {
        id: 'throwing', requiresKey: false,
        async invoke() { throw new Error('LLM should not have been called'); },
      },
    });
    const bridge2 = new InMemoryBridge({ id: 'a' });
    const agent2  = new HouseholdAgentFreeform({ bridges: [bridge2], llm: throwingLlm });
    await agent2.start();
    await bridge2.simulateIncoming({ text: '/add boodschappen brood' });
    expect(agent2.store.lists.get('boodschappen')).toEqual(['brood']);
    await agent2.stop();
  });

  it('strips bot username suffix (/add@MyBot …)', async () => {
    await agent.start();
    await bridge.simulateIncoming({ text: '/add@MyBot boodschappen brood' });
    expect(agent.store.lists.get('boodschappen')).toEqual(['brood']);
  });
});

describe('HouseholdAgentFreeform — LLM fallback for plain text', () => {
  it('plain text invokes the LLM', async () => {
    let invoked = 0;
    const llm = new LlmClient({
      provider: {
        id: 'count', requiresKey: false,
        async invoke() {
          invoked++;
          return { toolCall: null, classification: null, replyText: 'Hai!', raw: {} };
        },
      },
    });
    const bridge = new InMemoryBridge({ id: 'a' });
    const agent  = new HouseholdAgentFreeform({ bridges: [bridge], llm });
    await agent.start();
    await bridge.simulateIncoming({ text: 'hoi' });
    expect(invoked).toBe(1);
    expect(bridge.outbox[0].text).toBe('Hai!');
    await agent.stop();
  });

  it('LLM tool_call → addToList → store updated', async () => {
    const llm = new LlmClient({
      provider: mockProvider({
        responses: [{
          toolCalls: [
            { id: 'addToList', args: { listName: 'boodschappen', item: 'melk' } },
          ],
          classification: 'actionable',
        }],
      }),
    });
    const bridge = new InMemoryBridge({ id: 'a' });
    const agent  = new HouseholdAgentFreeform({ bridges: [bridge], llm });
    await agent.start();
    await bridge.simulateIncoming({ text: 'voeg melk toe aan boodschappen' });
    expect(agent.store.lists.get('boodschappen')).toEqual(['melk']);
    await agent.stop();
  });
});

describe('HouseholdAgentFreeform — caller-supplied store', () => {
  it('uses the caller\'s store when provided', async () => {
    // Pre-populate a custom store
    const { createListStore } = await import('../scripts/lib/freetext-core.js');
    const store = createListStore();
    store.addItem('inbox', 'task one');
    store.addItem('inbox', 'task two');

    const bridge = new InMemoryBridge({ id: 'a' });
    const llm    = new LlmClient({ provider: mockProvider({ responses: [{ replyText: 'ok' }] }) });
    const agent  = new HouseholdAgentFreeform({ bridges: [bridge], llm, store });

    expect(agent.store).toBe(store);
    expect(agent.store.lists.get('inbox')).toEqual(['task one', 'task two']);
  });
});

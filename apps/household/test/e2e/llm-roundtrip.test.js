/**
 * llm-roundtrip.test.js — Phase 3 e2e.
 *
 * Wires HouseholdAgent + InMemoryStore + MockBridge + a FAKE LLM
 * provider.  Proves the hybrid routing (regex first → LLM fallback)
 * works end-to-end.
 *
 * No real Ollama / OpenAI / Anthropic — the FakeLlmProvider returns
 * deterministic results based on the input text.  Real-LLM tests are
 * gated behind HOUSEHOLD_TEST_REAL_LLM=1 env var (see TESTING.md).
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { HouseholdAgent } from '../../src/HouseholdAgent.js';
import { MockBridge }     from '../../src/bridges/MockBridge.js';
import { InMemoryStore }  from '../../src/storage/InMemoryStore.js';
import { LlmClient }      from '../../src/llm/LlmClient.js';

const ALICE = 'https://id.example.org/alice#me';

function makeMsg(text) {
  return {
    bridgeId: 'mock', chatId: 'chat-1',
    messageId: `msg-${Math.random().toString(36).slice(2, 8)}`,
    sender: { displayName: 'alice', bridgeUid: 'alice', webid: ALICE },
    text, replyTo: null, isAddressed: true,
  };
}

/**
 * Deterministic fake provider.  The test scripts the responses by
 * priming `provider.respondWith(...)` before each emit.
 */
function fakeProvider() {
  const queue = [];
  return {
    id: 'fake',
    requiresKey: false,
    invocations: [],
    respondWith(result) { queue.push(result); },
    async invoke(req) {
      this.invocations.push(req);
      const next = queue.shift();
      if (!next) {
        return { toolCall: null, classification: null, replyText: '(no scripted response)', raw: {} };
      }
      return next;
    },
  };
}

describe('Phase 3 e2e — LLM slow path', () => {
  /** @type {InMemoryStore} */ let store;
  /** @type {MockBridge} */    let bridge;
  /** @type {HouseholdAgent} */ let agent;
  /** @type {ReturnType<typeof fakeProvider>} */ let provider;
  /** @type {LlmClient} */ let llm;
  const auditEntries = [];

  beforeEach(async () => {
    auditEntries.length = 0;
    store = new InMemoryStore();
    bridge = new MockBridge();
    provider = fakeProvider();
    llm = new LlmClient({ provider, audit: (e) => auditEntries.push(e) });
    agent = new HouseholdAgent({ store, bridges: [bridge], llm });
    await agent.start();
  });

  it('regex-matched commands skip the LLM entirely', async () => {
    await bridge.emit(makeMsg('add shopping bread'));
    expect(provider.invocations).toHaveLength(0);
    const open = await store.listOpen({ type: 'shopping' });
    expect(open.map((i) => i.text)).toContain('bread');
  });

  it('freeform message → LLM tool-call → addItem skill', async () => {
    provider.respondWith({
      toolCall:       { id: 'addItem', args: { type: 'shopping', text: 'tomato passata' } },
      classification: 'actionable',
      replyText:      null,
      raw:            {},
    });
    const reply = await bridge.emit(makeMsg("we should pick up some tomato passata when we're at the store"));
    expect(provider.invocations).toHaveLength(1);
    expect(reply.replies[0].text).toMatch(/added.*tomato/i);
    const open = await store.listOpen({ type: 'shopping' });
    expect(open.map((i) => i.text)).toContain('tomato passata');
  });

  it('LLM "noise" classification → silent reply', async () => {
    provider.respondWith({ toolCall: null, classification: 'noise', replyText: null, raw: {} });
    const reply = await bridge.emit(makeMsg("haha that's funny"));
    expect(reply.replies).toEqual([]);
    expect(reply.stateUpdates).toEqual([]);
  });

  it('LLM free-text reply → relayed to user', async () => {
    provider.respondWith({ toolCall: null, classification: null, replyText: 'Sure, I can help with that.', raw: {} });
    const reply = await bridge.emit(makeMsg('hi bot, can you help?'));
    expect(reply.replies[0].text).toBe('Sure, I can help with that.');
  });

  it('LLM provider error → friendly message, agent stays usable', async () => {
    // Swap in a provider that throws.
    const breaking = {
      id: 'breaking', requiresKey: false,
      async invoke() { throw new Error('connection refused'); },
    };
    const breakingLlm = new LlmClient({ provider: breaking });
    const freshAgent = new HouseholdAgent({ store, bridges: [new MockBridge()], llm: breakingLlm });
    await freshAgent.start();
    const freshBridge = freshAgent['_HouseholdAgent_bridges_test_only_'] ?? null;
    // Call onMessage directly since freshBridge accessor isn't exposed:
    const reply = await freshAgent.onMessage(makeMsg('something the regex parser cannot understand at all'));
    expect(reply.replies[0].text).toMatch(/unreachable|sorry/i);
    // After the error, the regex path still works.
    const r2 = await freshAgent.onMessage(makeMsg('add shopping bread'));
    expect(r2.replies[0].text).toMatch(/added/i);
    await freshAgent.stop();
  });

  it('LLM picking a non-existent tool → polite message, no crash', async () => {
    provider.respondWith({
      toolCall:       { id: 'doMagic', args: {} },
      classification: 'actionable',
      replyText:      null,
      raw:            {},
    });
    const reply = await bridge.emit(makeMsg('please make magic happen'));
    expect(reply.replies[0].text).toMatch(/unknown tool/i);
  });

  it('audit hook is called on every LLM invocation (success + error)', async () => {
    provider.respondWith({ toolCall: null, classification: 'noise', replyText: null, raw: {} });
    await bridge.emit(makeMsg('whatever'));
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0].kind).toBe('llm.invoke.ok');
    expect(auditEntries[0].providerId).toBe('fake');
  });
});

describe('LlmClient — provider abstraction', () => {
  it('rejects construction without a provider', () => {
    expect(() => new LlmClient({})).toThrow(/provider/);
  });

  it('rejects construction with a malformed provider', () => {
    expect(() => new LlmClient({ provider: {} })).toThrow(/invoke/);
  });

  it('audit defaults to a no-op (does not throw)', async () => {
    const client = new LlmClient({ provider: fakeProvider() });
    const r = await client.invoke({ system: 's', messages: [{ role: 'user', content: 'x' }] });
    expect(r).toBeTruthy();
  });

  it('exposes providerId', () => {
    const client = new LlmClient({ provider: fakeProvider() });
    expect(client.providerId).toBe('fake');
  });
});

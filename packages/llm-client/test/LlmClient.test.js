import { describe, it, expect, vi } from 'vitest';
import { LlmClient, mockProvider } from '../src/index.js';

describe('LlmClient', () => {
  it('routes invoke through the provider', async () => {
    const provider = mockProvider({
      responses: [{ replyText: 'hi', classification: null }],
    });
    const llm = new LlmClient({ provider });
    const result = await llm.invoke({
      system:   '...',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.replyText).toBe('hi');
    expect(result.classification).toBeNull();
  });

  it('runs the audit hook on success', async () => {
    const audit = vi.fn();
    const provider = mockProvider({
      responses: [{ toolCall: { id: 't', args: { a: 1 } }, classification: 'actionable' }],
    });
    const llm = new LlmClient({ provider, audit });
    await llm.invoke({ system: 's', messages: [{ role: 'user', content: 'go' }] });
    expect(audit).toHaveBeenCalledOnce();
    const entry = audit.mock.calls[0][0];
    expect(entry.kind).toBe('llm.invoke.ok');
    expect(entry.providerId).toBe('mock');
    expect(entry.input).toMatchObject({ system: 's' });
    // tools omitted from audit input (verbose)
    expect(entry.input.tools).toBeUndefined();
  });

  it('runs the audit hook on error and re-throws', async () => {
    const audit = vi.fn();
    const provider = mockProvider({
      invoke: async () => { throw new Error('boom'); },
    });
    const llm = new LlmClient({ provider, audit });
    await expect(
      llm.invoke({ system: 's', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow('boom');
    expect(audit).toHaveBeenCalledOnce();
    expect(audit.mock.calls[0][0].kind).toBe('llm.invoke.error');
  });

  it('survives audit-hook failures (audit must not crash the agent)', async () => {
    const provider = mockProvider({ responses: [{ replyText: 'hi' }] });
    const llm = new LlmClient({
      provider,
      audit: () => { throw new Error('audit-broken'); },
    });
    const result = await llm.invoke({ system: 's', messages: [{ role: 'user', content: 'hi' }] });
    expect(result.replyText).toBe('hi');
  });

  it('throws on missing provider', () => {
    expect(() => new LlmClient({})).toThrow(TypeError);
    expect(() => new LlmClient({ provider: {} })).toThrow(TypeError);
  });

  it('exposes providerId + requiresKey', () => {
    const provider = mockProvider({ responses: [{ replyText: 'x' }], id: 'fake-cloud' });
    provider.requiresKey = true;
    const llm = new LlmClient({ provider });
    expect(llm.providerId).toBe('fake-cloud');
    expect(llm.requiresKey).toBe(true);
  });
});

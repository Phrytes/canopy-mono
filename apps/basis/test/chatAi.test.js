/**
 * chatAi — chat is the surface; AI is an optional, gated enrichment.
 */
import { describe, it, expect } from 'vitest';
import { resolveChatAi } from '../src/v2/chatAi.js';

describe('resolveChatAi', () => {
  it('a circle that forbids LLM ("off") is never enriched — whatever the user loaded', () => {
    expect(resolveChatAi({ circleLlmTool: 'off', userLlmMode: 'local', hasProvider: true }))
      .toEqual({ enriched: false, reason: 'circle-off' });
  });

  it('no configured provider → not enriched (nothing to call)', () => {
    expect(resolveChatAi({ circleLlmTool: 'local', userLlmMode: 'local', hasProvider: false }))
      .toEqual({ enriched: false, reason: 'no-provider' });
  });

  it('policy "user": the member must have loaded an LLM', () => {
    expect(resolveChatAi({ circleLlmTool: 'user', userLlmMode: 'local', hasProvider: true }))
      .toEqual({ enriched: true, reason: 'on' });
    expect(resolveChatAi({ circleLlmTool: 'user', userLlmMode: 'off', hasProvider: true }))
      .toEqual({ enriched: false, reason: 'no-llm' });
  });

  it('policy "local"/"cloud" mandates an LLM → enriched when a provider exists (user choice irrelevant)', () => {
    expect(resolveChatAi({ circleLlmTool: 'local', userLlmMode: 'off', hasProvider: true }))
      .toEqual({ enriched: true, reason: 'on' });
    expect(resolveChatAi({ circleLlmTool: 'cloud', userLlmMode: 'off', hasProvider: true }))
      .toEqual({ enriched: true, reason: 'on' });
  });

  it('defaults are safe — off circle, no provider → not enriched', () => {
    expect(resolveChatAi()).toEqual({ enriched: false, reason: 'circle-off' });
  });
});

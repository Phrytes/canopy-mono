import { describe, it, expect, vi } from 'vitest';
import { buildCircleEmbedProviders } from '../../src/v2/circleEmbedProviders.js';
import { selectEmbedder, resolveCircleEmbedder } from '../../src/v2/embedPicker.js';

describe('buildCircleEmbedProviders', () => {
  it('empty map by default (opt-in — semantic RAG inert until a route is configured)', () => {
    expect(buildCircleEmbedProviders()).toEqual({});
    expect(buildCircleEmbedProviders({ model: 'x' })).toEqual({});   // no base URL → nothing
  });

  it('builds local + cloud EmbeddingClients with per-route model/key', () => {
    const p = buildCircleEmbedProviders({
      localBaseUrl: 'http://127.0.0.1:11434', localModel: 'nomic-embed-text',
      cloudBaseUrl: 'https://api.privatemode.ai/v1', cloudModel: 'qwen3-embedding-4b', cloudApiKey: 'sk-1',
    });
    expect(p.local.providerId).toBe('openai-embeddings');
    expect(p.local.model).toBe('nomic-embed-text');
    expect(p.local.requiresKey).toBe(false);
    expect(p.cloud.model).toBe('qwen3-embedding-4b');
    expect(p.cloud.requiresKey).toBe(true);          // keyed enclave route
  });
});

describe('selectEmbedder', () => {
  const providers = { local: { id: 'L' }, cloud: { id: 'C' } };
  it('off / missing / malformed → null', () => {
    expect(selectEmbedder({ embedTool: 'off' }, providers)).toBeNull();
    expect(selectEmbedder(null, providers)).toBeNull();
    expect(selectEmbedder({ embedTool: 'nonsense' }, providers)).toBeNull();
  });
  it('local / cloud pick the matching client', () => {
    expect(selectEmbedder({ embedTool: 'local' }, providers)).toBe(providers.local);
    expect(selectEmbedder({ embedTool: 'cloud' }, providers)).toBe(providers.cloud);
  });
  it('falls back to the llmTool axis when embedTool is absent (ride the LLM route)', () => {
    expect(selectEmbedder({ llmTool: 'cloud' }, providers)).toBe(providers.cloud);
    expect(selectEmbedder({ llmTool: 'local' }, providers)).toBe(providers.local);
  });
  it('embedTool overrides llmTool (decouple)', () => {
    expect(selectEmbedder({ llmTool: 'cloud', embedTool: 'local' }, providers)).toBe(providers.local);
    expect(selectEmbedder({ llmTool: 'cloud', embedTool: 'off' }, providers)).toBeNull();
  });
  it('unconfigured route → null even when selected', () => {
    expect(selectEmbedder({ embedTool: 'cloud' }, { local: { id: 'L' } })).toBeNull();
  });
});

describe('resolveCircleEmbedder', () => {
  const providers = { local: { id: 'L' }, cloud: { id: 'C' } };
  it('circle policy is authoritative; off is a hard-stop over the user default', () => {
    expect(resolveCircleEmbedder({ circlePolicy: { embedTool: 'off' }, userDefault: { mode: 'cloud' }, providers })).toBeNull();
    expect(resolveCircleEmbedder({ circlePolicy: { embedTool: 'cloud' }, providers })).toBe(providers.cloud);
  });
  it("'user' delegates to the member default", () => {
    expect(resolveCircleEmbedder({ circlePolicy: { embedTool: 'user' }, userDefault: { mode: 'local' }, providers })).toBe(providers.local);
    expect(resolveCircleEmbedder({ circlePolicy: { embedTool: 'user' }, userDefault: { mode: 'off' }, providers })).toBeNull();
    expect(resolveCircleEmbedder({ circlePolicy: { embedTool: 'user' }, providers })).toBeNull();   // no default → off
  });
  it('embedTool absent → rides llmTool', () => {
    expect(resolveCircleEmbedder({ circlePolicy: { llmTool: 'cloud' }, providers })).toBe(providers.cloud);
  });
});

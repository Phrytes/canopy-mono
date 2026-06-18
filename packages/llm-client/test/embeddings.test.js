import { describe, it, expect, vi } from 'vitest';
import {
  EmbeddingClient,
  openaiEmbeddingsProvider,
  parseEmbeddingsResponse,
  mockEmbeddingsProvider,
  EMBEDDINGS_DEFAULT_MODEL,
} from '../src/index.js';

// Build a fetch stub that returns an OpenAI-style embeddings payload.
function fetchStub(payload, { ok = true, status = 200 } = {}) {
  return vi.fn(async () => ({
    ok, status,
    json: async () => payload,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  }));
}

describe('openaiEmbeddingsProvider', () => {
  it('POSTs {model,input} to /v1/embeddings and returns vectors in input order', async () => {
    const fetchFn = fetchStub({
      data: [
        { index: 1, embedding: [0.3, 0.4] },
        { index: 0, embedding: [0.1, 0.2] },   // out of order on the wire
      ],
    });
    const p = openaiEmbeddingsProvider({ baseUrl: 'http://enclave:8080', model: 'qwen3-embedding-4b', fetchFn });
    const out = await p.embed(['first', 'second']);
    expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]]);   // re-sorted by `index`
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://enclave:8080/v1/embeddings');
    expect(JSON.parse(init.body)).toEqual({ model: 'qwen3-embedding-4b', input: ['first', 'second'] });
    expect(p.requiresKey).toBe(false);
    expect(p.model).toBe('qwen3-embedding-4b');
  });

  it('strips a trailing /v1 from baseUrl (no double /v1) and sends a Bearer key when given', async () => {
    const fetchFn = fetchStub({ data: [{ index: 0, embedding: [1] }] });
    const p = openaiEmbeddingsProvider({ baseUrl: 'https://api.privatemode.ai/v1/', apiKey: 'sk-xyz', fetchFn });
    await p.embed('hi');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.privatemode.ai/v1/embeddings');
    expect(init.headers.Authorization).toBe('Bearer sk-xyz');
    expect(p.requiresKey).toBe(true);
    expect(p.model).toBe(EMBEDDINGS_DEFAULT_MODEL);   // qwen3-embedding-4b default
  });

  it('throws a PROVIDER_ERROR on a non-ok response', async () => {
    const fetchFn = fetchStub('model not found', { ok: false, status: 404 });
    const p = openaiEmbeddingsProvider({ baseUrl: 'http://x', fetchFn });
    await expect(p.embed('q')).rejects.toMatchObject({ code: 'PROVIDER_ERROR', status: 404 });
  });

  it('empty input → no fetch, returns []', async () => {
    const fetchFn = fetchStub({ data: [] });
    const p = openaiEmbeddingsProvider({ baseUrl: 'http://x', fetchFn });
    expect(await p.embed([])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('requires baseUrl', () => {
    expect(() => openaiEmbeddingsProvider({})).toThrow(/baseUrl required/);
  });
});

describe('parseEmbeddingsResponse', () => {
  it('returns [] for a malformed payload', () => {
    expect(parseEmbeddingsResponse(null)).toEqual([]);
    expect(parseEmbeddingsResponse({})).toEqual([]);
  });
  it('keeps wire order when no index field is present', () => {
    expect(parseEmbeddingsResponse({ data: [{ embedding: [2] }, { embedding: [1] }] }))
      .toEqual([[2], [1]]);
  });
});

describe('EmbeddingClient', () => {
  it('routes embed() through the provider + runs the audit hook (count/dims only — no text)', async () => {
    const audits = [];
    const client = new EmbeddingClient({
      provider: mockEmbeddingsProvider({ dims: 8 }),
      audit: (e) => audits.push(e),
    });
    const out = await client.embed(['milk', 'bread']);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(8);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ kind: 'embed.ok', providerId: 'mock-embeddings', input: { count: 2 }, output: { count: 2, dims: 8 } });
    expect(JSON.stringify(audits[0])).not.toContain('milk');   // text never audited
  });

  it('embedOne returns a single vector', async () => {
    const client = new EmbeddingClient({ provider: mockEmbeddingsProvider() });
    const v = await client.embedOne('hello world');
    expect(Array.isArray(v)).toBe(true);
  });

  it('audits + rethrows on provider error', async () => {
    const audits = [];
    const client = new EmbeddingClient({
      provider: { id: 'boom', embed: async () => { throw new Error('down'); } },
      audit: (e) => audits.push(e),
    });
    await expect(client.embed(['x'])).rejects.toThrow('down');
    expect(audits[0]).toMatchObject({ kind: 'embed.error', providerId: 'boom' });
  });

  it('rejects a provider without embed()', () => {
    expect(() => new EmbeddingClient({ provider: {} })).toThrow(/provider with embed/);
  });
});

describe('mockEmbeddingsProvider — deterministic + token-aware (for semanticQuery tests)', () => {
  it('same text → same vector; shared tokens → higher cosine than unrelated', async () => {
    const p = mockEmbeddingsProvider({ dims: 32 });
    const [a1] = await p.embed(['return the borrowed ladder']);
    const [a2] = await p.embed(['return the borrowed ladder']);
    expect(a1).toEqual(a2);                                  // deterministic
    const [ladderQ] = await p.embed(['is the ladder still here']);
    const [bbqRow]  = await p.embed(['street bbq on saturday']);
    const cos = (x, y) => x.reduce((s, xi, i) => s + xi * y[i], 0);
    expect(cos(a1, ladderQ)).toBeGreaterThan(cos(a1, bbqRow));   // shares "ladder"
  });
});

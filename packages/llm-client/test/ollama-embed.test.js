import { describe, it, expect, vi } from 'vitest';
import {
  ollamaEmbedProvider,
  parseOllamaEmbedResponse,
  createEmbeddingsClient,
  mockEmbeddingsProvider,
  OLLAMA_EMBED_DEFAULT_MODEL,
} from '../src/index.js';

// A fetch stub returning an Ollama `/api/embed` batch payload.
function fetchStub(payload, { ok = true, status = 200 } = {}) {
  return vi.fn(async () => ({
    ok, status,
    json: async () => payload,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  }));
}

describe('ollamaEmbedProvider', () => {
  it('POSTs {model,input} to /api/embed and parses embeddings → Float32Array[] in order', async () => {
    const fetchFn = fetchStub({ model: 'nomic-embed-text', embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]] });
    const p = ollamaEmbedProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'nomic-embed-text', fetchFn });

    expect(p.id).toBe('ollama:nomic-embed-text');
    expect(p.dim).toBeUndefined();   // not known up front

    const out = await p.embed(['first', 'second']);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/embed');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ model: 'nomic-embed-text', input: ['first', 'second'] });

    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(out[0])).toEqual([0.1, 0.2, 0.3].map((n) => Math.fround(n)));
    expect(p.dim).toBe(3);           // learned from the first response
  });

  it('works against a LAN base URL and sends a Bearer key when given', async () => {
    const fetchFn = fetchStub({ embeddings: [[1, 0]] });
    const p = ollamaEmbedProvider({ baseUrl: 'http://10.0.0.5:11434/', model: 'mxbai-embed-large', apiKey: 'sk-lan', fetchFn });
    await p.embed('hi');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://10.0.0.5:11434/api/embed');
    expect(init.headers.Authorization).toBe('Bearer sk-lan');
    expect(p.requiresKey).toBe(true);
  });

  it('strips a trailing /api so both host and /api forms work (no double /api)', async () => {
    const fetchFn = fetchStub({ embeddings: [[1]] });
    const p = ollamaEmbedProvider({ baseUrl: 'http://host:11434/api', model: 'nomic-embed-text', fetchFn });
    await p.embed('x');
    expect(fetchFn.mock.calls[0][0]).toBe('http://host:11434/api/embed');
  });

  it('honours a dim passed up front (skips learning)', async () => {
    const p = ollamaEmbedProvider({ baseUrl: 'http://x', model: 'm', dim: 768, fetchFn: fetchStub({ embeddings: [[1, 2]] }) });
    expect(p.dim).toBe(768);
    await p.embed('a');
    expect(p.dim).toBe(768);          // not overwritten by the 2-d response
  });

  it('empty input → no fetch, returns []', async () => {
    const fetchFn = fetchStub({ embeddings: [] });
    const p = ollamaEmbedProvider({ baseUrl: 'http://x', model: 'm', fetchFn });
    expect(await p.embed([])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws E_EMBED_PROVIDER on a non-ok response', async () => {
    const fetchFn = fetchStub('model not found', { ok: false, status: 404 });
    const p = ollamaEmbedProvider({ baseUrl: 'http://x', model: 'm', fetchFn });
    await expect(p.embed('q')).rejects.toMatchObject({ code: 'E_EMBED_PROVIDER', status: 404 });
  });

  it('throws E_EMBED_PROVIDER on a transport failure (fetch rejects)', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const p = ollamaEmbedProvider({ baseUrl: 'http://x', model: 'm', fetchFn, timeoutMs: 0 });
    await expect(p.embed('q')).rejects.toMatchObject({ code: 'E_EMBED_PROVIDER' });
  });

  it('requires a model', () => {
    expect(() => ollamaEmbedProvider({ baseUrl: 'http://x', model: '' })).toThrow(/model required/);
  });

  it('exposes the default model id', () => {
    expect(OLLAMA_EMBED_DEFAULT_MODEL).toBe('nomic-embed-text');
  });
});

describe('parseOllamaEmbedResponse', () => {
  it('maps embeddings rows to Float32Array', () => {
    const out = parseOllamaEmbedResponse({ embeddings: [[1, 2], [3, 4]] });
    expect(out.every((v) => v instanceof Float32Array)).toBe(true);
    expect(Array.from(out[1])).toEqual([3, 4]);
  });
  it('returns [] for a malformed payload', () => {
    expect(parseOllamaEmbedResponse(null)).toEqual([]);
    expect(parseOllamaEmbedResponse({})).toEqual([]);
  });
});

describe('createEmbeddingsClient (§3.1 contract)', () => {
  it('returns { vectors, modelId, dim } and audits count/dims only (no text)', async () => {
    const audits = [];
    const client = createEmbeddingsClient({
      provider: mockEmbeddingsProvider({ dims: 8 }),
      audit: (e) => audits.push(e),
    });
    const { vectors, modelId, dim } = await client.embed(['milk', 'bread']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(8);
    expect(modelId).toBe('mock-embeddings');
    expect(dim).toBe(8);

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ kind: 'embed.ok', providerId: 'mock-embeddings', input: { count: 2 }, output: { count: 2, dims: 8 } });
    expect(JSON.stringify(audits[0])).not.toContain('milk');   // text never audited
  });

  it('threads modelId through from an ollamaEmbedProvider (index-versioning key)', async () => {
    const provider = ollamaEmbedProvider({ baseUrl: 'http://x', model: 'nomic-embed-text', fetchFn: fetchStub({ embeddings: [[1, 2, 3]] }) });
    const client = createEmbeddingsClient({ provider });
    const { modelId, dim, vectors } = await client.embed(['q']);
    expect(modelId).toBe('ollama:nomic-embed-text');
    expect(dim).toBe(3);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
  });

  it('E_EMBED_EMPTY_INPUT on an empty array or all-blank input', async () => {
    const client = createEmbeddingsClient({ provider: mockEmbeddingsProvider() });
    await expect(client.embed([])).rejects.toMatchObject({ code: 'E_EMBED_EMPTY_INPUT' });
    await expect(client.embed(['   ', ''])).rejects.toMatchObject({ code: 'E_EMBED_EMPTY_INPUT' });
  });

  it('E_EMBED_PROVIDER when the provider throws a bare (non-coded) error', async () => {
    const audits = [];
    const client = createEmbeddingsClient({
      provider: { id: 'boom', embed: async () => { throw new Error('down'); } },
      audit: (e) => audits.push(e),
    });
    await expect(client.embed(['x'])).rejects.toMatchObject({ code: 'E_EMBED_PROVIDER' });
    expect(audits[0]).toMatchObject({ kind: 'embed.error', providerId: 'boom', output: { code: 'E_EMBED_PROVIDER' } });
  });

  it('passes a provider E_EMBED_PROVIDER through unchanged', async () => {
    const provider = ollamaEmbedProvider({ baseUrl: 'http://x', model: 'm', fetchFn: fetchStub('nope', { ok: false, status: 500 }) });
    const client = createEmbeddingsClient({ provider });
    await expect(client.embed(['x'])).rejects.toMatchObject({ code: 'E_EMBED_PROVIDER', status: 500 });
  });

  it('E_EMBED_DIM_MISMATCH on a ragged batch', async () => {
    const provider = { id: 'ragged', embed: async () => [new Float32Array([1, 2, 3]), new Float32Array([1, 2])] };
    const client = createEmbeddingsClient({ provider });
    await expect(client.embed(['a', 'b'])).rejects.toMatchObject({ code: 'E_EMBED_DIM_MISMATCH' });
  });

  it('rejects a provider without embed()', () => {
    expect(() => createEmbeddingsClient({ provider: {} })).toThrow(/provider with embed/);
  });
});

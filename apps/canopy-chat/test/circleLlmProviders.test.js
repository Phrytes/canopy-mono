/**
 * buildCircleLlmProviders — apiKey threading for the Privatemode (OpenAI-gateway)
 * route. Proves the full chain: builder → ollamaProvider → fetch sends the Bearer
 * project key, and that the Privatemode `/v1` base form normalises correctly.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildCircleLlmProviders } from '../src/v2/circleLlmProviders.js';

const ok = () => new Response(
  JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);

describe('buildCircleLlmProviders — apiKey (Privatemode Bearer)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('threads apiKey → Bearer header, and normalises a /v1 base to /v1/chat/completions', async () => {
    let captured;
    globalThis.fetch = async (url, init) => { captured = { url, headers: init.headers }; return ok(); };
    const providers = buildCircleLlmProviders({
      localBaseUrl: 'http://localhost:8080/v1',   // Privatemode proxy (the /v1 form)
      model:        'gpt-oss-120b',
      apiKey:       'pm-project-key',
    });
    await providers.local.invoke({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] });
    expect(captured.url).toBe('http://localhost:8080/v1/chat/completions');   // normalizeBase strips /v1, provider re-adds
    expect(captured.headers.Authorization).toBe('Bearer pm-project-key');
  });

  it('no apiKey → no Authorization (local Ollama unchanged)', async () => {
    let captured;
    globalThis.fetch = async (url, init) => { captured = init.headers; return ok(); };
    const providers = buildCircleLlmProviders({ localBaseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:3b' });
    await providers.local.invoke({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] });
    expect(captured.Authorization).toBeUndefined();
  });

  it('cloudApiKey falls back to apiKey for the cloud route', async () => {
    let captured;
    globalThis.fetch = async (url, init) => { captured = init.headers; return ok(); };
    const providers = buildCircleLlmProviders({ cloudBaseUrl: 'https://enclave.example/v1', model: 'gpt-oss-120b', apiKey: 'shared-key' });
    await providers.cloud.invoke({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] });
    expect(captured.Authorization).toBe('Bearer shared-key');
  });
});

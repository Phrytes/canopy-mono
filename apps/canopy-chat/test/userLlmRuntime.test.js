/**
 * User-settable LLM/embedder endpoints: the store carries a member's own {preset, llmBaseUrl, …},
 * the runtime builds providers from it (env fallback), and the confidential-route guard refuses a
 * "confidential" preset pointed at a host that could read raw circle text.
 */
import { describe, it, expect } from 'vitest';
import { normalizeUserLlmDefault, createUserLlmDefaultStore } from '../src/v2/userLlmDefault.js';
import { validateUserLlmConfig, buildUserLlmRuntime, applyUserLlmRuntime, modeForUserCfg } from '../src/v2/userLlmRuntime.js';

describe('userLlmDefault store', () => {
  it('back-compat: an old {mode:"local"} value maps to the local-ollama preset', () => {
    const v = normalizeUserLlmDefault({ mode: 'local' });
    expect(v.preset).toBe('local-ollama');
    expect(v.mode).toBe('local');
  });
  it('normalizes the full endpoint shape + coerces types', () => {
    const v = normalizeUserLlmDefault({ preset: 'openai-compatible', llmBaseUrl: ' https://x/v1 ', attestation: 'true' });
    expect(v).toMatchObject({ preset: 'openai-compatible', mode: 'cloud', llmBaseUrl: 'https://x/v1', attestation: true });
  });
  it('set() merges a partial patch onto the current value', async () => {
    let saved = null;
    const store = createUserLlmDefaultStore({ load: () => saved, save: (v) => { saved = v; } });
    await store.set({ preset: 'local-ollama', llmBaseUrl: 'http://127.0.0.1:11434', llmModel: 'qwen2.5:7b-instruct' });
    await store.set({ embedBaseUrl: 'http://127.0.0.1:11434' });   // patch only embed
    const v = await store.get();
    expect(v.llmBaseUrl).toBe('http://127.0.0.1:11434');           // preserved
    expect(v.embedBaseUrl).toBe('http://127.0.0.1:11434');         // added
  });
});

describe('confidential-route guard via validateUserLlmConfig', () => {
  it('refuses a confidential preset on a non-loopback host', () => {
    const msg = validateUserLlmConfig({ preset: 'confidential-proxy', llmBaseUrl: 'https://evil.example.com/v1' });
    expect(msg).toMatch(/confidential/i);
  });
  it('allows a confidential preset on loopback', () => {
    expect(validateUserLlmConfig({ preset: 'confidential-proxy', llmBaseUrl: 'http://localhost:8080' })).toBeNull();
  });
  it('allows a confidential remote host WHEN attestation is asserted', () => {
    expect(validateUserLlmConfig({ preset: 'confidential-proxy', llmBaseUrl: 'https://enclave.example.com/v1', attestation: true })).toBeNull();
  });
  it('does NOT gate an explicit openai-compatible cloud (user opt-in)', () => {
    expect(validateUserLlmConfig({ preset: 'openai-compatible', llmBaseUrl: 'https://api.openai.com/v1' })).toBeNull();
  });
  it('also guards the EMBEDDER url (raw text)', () => {
    const msg = validateUserLlmConfig({ preset: 'confidential-proxy', llmBaseUrl: 'http://localhost:8080', embedBaseUrl: 'https://leak.example.com/v1' });
    expect(msg).toMatch(/embedder/i);
  });
});

describe('buildUserLlmRuntime', () => {
  it('builds the LLM provider under the mode-matched key (local-ollama → providers.local)', () => {
    const rt = buildUserLlmRuntime({ preset: 'local-ollama', llmBaseUrl: 'http://127.0.0.1:11434', llmModel: 'qwen2.5:7b-instruct' });
    expect(rt.mode).toBe('local');
    expect(rt.llmProviders.local).toBeTruthy();
    expect(rt.llmProviders.cloud).toBeFalsy();
  });
  it('cloud preset → providers.cloud + builds the embedder too', () => {
    const rt = buildUserLlmRuntime({ preset: 'openai-compatible', llmBaseUrl: 'https://api.x/v1', embedBaseUrl: 'https://api.x/v1', embedModel: 'e5' });
    expect(rt.mode).toBe('cloud');
    expect(rt.llmProviders.cloud).toBeTruthy();
    expect(rt.embedProviders.cloud).toBeTruthy();
  });
  it('falls back to env when the user has no preset', () => {
    const rt = buildUserLlmRuntime({ preset: 'off' }, { env: { llmBaseUrl: 'http://localhost:8080', embedBaseUrl: 'http://localhost:8080' } });
    expect(rt.mode).toBe('local');
    expect(rt.llmProviders.local).toBeTruthy();
    expect(rt.embedProviders.local).toBeTruthy();
  });
  it('throws on an unsafe confidential route', () => {
    expect(() => buildUserLlmRuntime({ preset: 'confidential-proxy', llmBaseUrl: 'https://evil/v1' })).toThrow(/confidential/i);
  });
});

describe('applyUserLlmRuntime — live in-place swap', () => {
  it('mutates the existing providers objects so the bot keeps its reference', () => {
    const llmProviders = { local: { old: true } };
    const embedProviders = {};
    const r = applyUserLlmRuntime({
      userCfg: { preset: 'openai-compatible', llmBaseUrl: 'https://api.x/v1', embedBaseUrl: 'https://api.x/v1' },
      llmProviders, embedProviders,
    });
    expect(r).toMatchObject({ ok: true, mode: 'cloud' });
    expect(llmProviders.local).toBeUndefined();   // old cleared
    expect(llmProviders.cloud).toBeTruthy();       // new applied in place
    expect(embedProviders.cloud).toBeTruthy();
  });
  it('returns {ok:false,error} on an unsafe route, leaving providers untouched', () => {
    const llmProviders = { local: { keep: true } };
    const r = applyUserLlmRuntime({ userCfg: { preset: 'confidential-proxy', llmBaseUrl: 'https://evil/v1' }, llmProviders });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/confidential/i);
    expect(llmProviders.local).toEqual({ keep: true });   // untouched
  });
  it('modeForUserCfg derives posture from the preset', () => {
    expect(modeForUserCfg({ preset: 'local-ollama' })).toBe('local');
    expect(modeForUserCfg({ preset: 'confidential-proxy' })).toBe('cloud');
    expect(modeForUserCfg({ preset: 'off' })).toBe('off');
  });
});

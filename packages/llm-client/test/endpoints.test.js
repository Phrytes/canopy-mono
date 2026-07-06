import { describe, it, expect } from 'vitest';
import { resolveEndpoint } from '../src/endpoints.js';
import { ollamaProvider } from '../src/providers/ollama.js';

const config = {
  endpoints: {
    local:   { baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b-instruct' },
    enclave: { baseUrl: 'https://enclave.local', model: 'qwen3-4b', apiKey: 'sk-x', headers: { 'X-Tenant': 'acme' } },
  },
  default: 'local',
  customers: { acme: 'enclave' },
};

describe('resolveEndpoint', () => {
  it('selects by explicit name', () => {
    expect(resolveEndpoint(config, { name: 'enclave' }))
      .toMatchObject({ name: 'enclave', baseUrl: 'https://enclave.local', model: 'qwen3-4b', apiKey: 'sk-x' });
  });

  it('selects by customer mapping', () => {
    expect(resolveEndpoint(config, { customerId: 'acme' }).name).toBe('enclave');
  });

  it('falls back to config.default for an unmapped customer', () => {
    expect(resolveEndpoint(config, { customerId: 'bob' }).name).toBe('local');
  });

  it('falls back to config.default with no selector', () => {
    expect(resolveEndpoint(config).name).toBe('local');
  });

  it('name wins over the customer mapping', () => {
    expect(resolveEndpoint(config, { name: 'local', customerId: 'acme' }).name).toBe('local');
  });

  it('uses the sole endpoint when exactly one is defined and no default', () => {
    const one = { endpoints: { only: { baseUrl: 'http://h', model: 'm' } } };
    expect(resolveEndpoint(one).name).toBe('only');
  });

  it('throws when selection is ambiguous (multiple, no default, no selector)', () => {
    const ambiguous = { endpoints: { a: { baseUrl: 'x' }, b: { baseUrl: 'y' } } };
    expect(() => resolveEndpoint(ambiguous)).toThrow(/no endpoint selected/);
  });

  it('throws on unknown endpoint name', () => {
    expect(() => resolveEndpoint(config, { name: 'nope' })).toThrow(/unknown endpoint/);
  });

  it('throws on missing / empty endpoints', () => {
    expect(() => resolveEndpoint({})).toThrow(TypeError);
    expect(() => resolveEndpoint({ endpoints: {} })).toThrow(TypeError);
  });

  it('resolved endpoint spreads straight into ollamaProvider', () => {
    const ep = resolveEndpoint(config, { customerId: 'acme' });
    const provider = ollamaProvider(ep);
    expect(provider.model).toBe('qwen3-4b');
    expect(provider.endpoint).toBe('https://enclave.local');
  });
});

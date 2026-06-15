/**
 * Mobile per-circle pod producers + content-seal strategy (RN parity with web). Drives the
 * REAL sealing substrate (pure-JS tweetnacl/@noble — RN-safe) over an in-memory pseudo-pod
 * + an injected mock AsyncStorage vault. Proves a p2 circle resolves a working seal/open
 * strategy and a p0 circle resolves none (cleartext).
 */
import { describe, it, expect } from 'vitest';
import { initCirclePods, getCircleSealStrategy } from '../src/core/circlePods.js';

function mockAsyncStorage() {
  const m = new Map();
  return {
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, String(v)); },
    removeItem: async (k) => { m.delete(k); },
  };
}

describe('mobile circlePods', () => {
  it('p2 circle resolves a content seal/open strategy that round-trips', async () => {
    initCirclePods(mockAsyncStorage());
    const strat = await getCircleSealStrategy('mob-p2', { storagePosture: 'p2' });
    expect(strat).toBeTruthy();
    expect(strat.open(strat.seal('hoi kring'))).toBe('hoi kring');
  });

  it('p0 circle → null strategy (cleartext, no sealing)', async () => {
    initCirclePods(mockAsyncStorage());
    const strat = await getCircleSealStrategy('mob-p0', { storagePosture: 'p0' });
    expect(strat).toBeNull();
  });

  it('caches the strategy per circle (stable across calls)', async () => {
    initCirclePods(mockAsyncStorage());
    const a = await getCircleSealStrategy('mob-cache', { storagePosture: 'p2' });
    const b = await getCircleSealStrategy('mob-cache', { storagePosture: 'p2' });
    expect(a).toBe(b);
  });
});

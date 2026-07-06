import { describe, it, expect } from 'vitest';
import { demo } from '../index.js';

/**
 * Smoke test — the demo runs fully OFFLINE (pseudo-pod + mock embedder) and
 * proves the pod-search V2 story end-to-end: persist under private/state/,
 * reload without re-embedding, and hybrid/semantic surface the synonym a
 * lexical query misses.
 */
describe('pod-search-embeddings-demo', () => {
  it('provisions, persists privately, reloads without re-embedding, and fuses', async () => {
    const r = await demo();
    // Persistence privacy invariant.
    expect(r.persistedKeys).toBeGreaterThan(0);
    expect(r.allPrivate).toBe(true);
    expect(r.noSharing).toBe(true);
    // Restart ≠ re-embed: reloading a fresh PodSearch over the same store
    // embeds ZERO chunks (only the query itself was embedded).
    expect(r.reloadReEmbeds).toBe(0);
    expect(r.reloadedReady).toBe(true);
    // Semantic/hybrid surface the synonym note (n1) lexical alone misses.
    expect(r.lexical).toEqual(['n2']);
    expect(r.semantic).toContain('n1');
    expect(r.hybrid).toEqual(expect.arrayContaining(['n1', 'n2']));
    expect(r.reHybrid).toEqual(expect.arrayContaining(['n1', 'n2']));
    // Degradation: no embedder ⇒ hybrid silently equals lexical.
    expect(r.degraded).toEqual(['n2']);
  });
});

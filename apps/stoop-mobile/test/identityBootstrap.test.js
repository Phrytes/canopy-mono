/**
 * identityBootstrap — verify load-or-generate + clear via stub vault.
 *
 * AgentIdentity.generate() / .restore() do real ed25519 keygen via
 * tweetnacl, so the stub just needs to behave like the canonical
 * vault interface (`get` / `set` / `delete` / `has`).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadOrGenerateIdentity, clearIdentity } from '../src/lib/identityBootstrap.js';

function makeVault() {
  const store = new Map();
  return {
    get:    async (k) => store.get(k) ?? null,
    set:    async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
    has:    async (k) => store.has(k),
    _store: store,
  };
}

describe('loadOrGenerateIdentity', () => {
  let vault;
  beforeEach(() => { vault = makeVault(); });

  it('generates a fresh identity on first call', async () => {
    const r = await loadOrGenerateIdentity({ vault });
    expect(r.isFresh).toBe(true);
    expect(r.identity).toBeTruthy();
    expect(typeof r.identity.pubKey).toBe('string');
    expect(r.identity.pubKey.length).toBeGreaterThan(0);
  });

  it('returns the same identity on a second call', async () => {
    const a = await loadOrGenerateIdentity({ vault });
    const b = await loadOrGenerateIdentity({ vault });
    expect(b.isFresh).toBe(false);
    expect(b.identity.pubKey).toBe(a.identity.pubKey);
  });

  it('persists the seed under agent-privkey', async () => {
    await loadOrGenerateIdentity({ vault });
    const raw = await vault.get('agent-privkey');
    expect(typeof raw).toBe('string');
    expect(raw.length).toBeGreaterThan(0);
  });
});

describe('clearIdentity', () => {
  it('wipes agent-privkey + derived keys', async () => {
    const vault = makeVault();
    await loadOrGenerateIdentity({ vault });
    expect(vault._store.size).toBeGreaterThan(0);
    await clearIdentity({ vault });
    expect(vault._store.has('agent-privkey')).toBe(false);
  });

  it('is a no-op when no identity exists', async () => {
    const vault = makeVault();
    await expect(clearIdentity({ vault })).resolves.toBeUndefined();
  });
});

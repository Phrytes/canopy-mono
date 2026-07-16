/**
 * folio — registerFolioAgent self-registration (Slice 1b,
 * PLAN-folio-as-file-agent.md).  Folio advertises its pod-file
 * capabilities into `@onderling/agent-registry` so it appears as a
 * connectable file agent in the "your agents" roster.
 */
import { describe, it, expect } from 'vitest';

import { registerFolioAgent, FOLIO_CAPABILITIES } from '../src/registerFolioAgent.js';
import { folioManifest } from '../manifest.js';

/** Minimal in-memory pseudo-pod: read/write a Map of uri → resource body. */
function makePseudoPodStub() {
  const map = new Map();
  return {
    _map: map,
    async read(uri)  { return map.has(uri) ? { bytes: map.get(uri), etag: null } : null; },
    async write(uri, body) { map.set(uri, body); return { etag: null }; },
  };
}

describe('registerFolioAgent — self-registration into @onderling/agent-registry', () => {
  it('advertised capabilities = the manifest browser (pod-file) op ids', () => {
    const browserIds = folioManifest.operations
      .filter((o) => o.runtime === 'browser')
      .map((o) => o.id);
    expect([...FOLIO_CAPABILITIES]).toEqual(browserIds);
  });

  it('registers a folio SERVICE agent carrying its pod-file capabilities', async () => {
    const pod   = makePseudoPodStub();
    const agent = { identity: { pubKey: 'pub-folio', deviceId: 'folio-install' } };

    const registry = await registerFolioAgent({ pseudoPod: pod, deviceId: 'device-authority', agent });
    expect(registry).not.toBeNull();

    const entries = await registry.list();
    const folio = entries.find((a) => a.pubKey === 'pub-folio');
    expect(folio).toBeDefined();
    expect(folio.name).toBe('folio');
    expect(folio.role).toBe('service');
    expect([...folio.capabilities].sort()).toEqual([...FOLIO_CAPABILITIES].sort());
  });

  it('soft-fails to null when the agent carries no key (never throws)', async () => {
    const res = await registerFolioAgent({ pseudoPod: makePseudoPodStub(), deviceId: 'd', agent: {} });
    expect(res).toBeNull();
  });
});

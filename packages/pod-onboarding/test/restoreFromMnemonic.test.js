/**
 * restoreFromMnemonic — re-attach an agent on a new device.
 */

import { describe, it, expect } from 'vitest';
import { generateMnemonic } from '@canopy/core';
import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';
import { restoreFromMnemonic } from '../src/restoreFromMnemonic.js';

const MNEMONIC = generateMnemonic();

describe('restoreFromMnemonic — input validation', () => {
  it('rejects missing mnemonic', async () => {
    await expect(restoreFromMnemonic({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('restoreFromMnemonic — identity-only path (no pod, no webid)', () => {
  it('returns the deterministic identity', async () => {
    const r1 = await restoreFromMnemonic({ mnemonic: MNEMONIC });
    const r2 = await restoreFromMnemonic({ mnemonic: MNEMONIC });
    expect(r1.identity).toBeTruthy();
    expect(r2.identity).toBeTruthy();
    // Same mnemonic → same pubkey (deterministic).
    expect(Buffer.from(r1.identity.pubKey).toString('hex'))
      .toBe(Buffer.from(r2.identity.pubKey).toString('hex'));
  });
});

describe('restoreFromMnemonic — pseudo-pod replica path', () => {
  it('pulls storage-mapping + agent-registry from the pseudo-pod', async () => {
    const deviceId = 'laptop-anne';
    const pseudoPod = createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'standalone',
      deviceId,
    });
    await pseudoPod.write(
      `pseudo-pod://${deviceId}/private/storage-mapping`,
      { version: 2, mappings: {}, crewPolicies: {} },
    );
    await pseudoPod.write(
      `pseudo-pod://${deviceId}/private/agent-registry`,
      { version: 1, agents: [] },
    );
    const r = await restoreFromMnemonic({
      mnemonic: MNEMONIC,
      pseudoPod,
      deviceId,
    });
    expect(r.storageMapping).toMatchObject({ version: 2 });
    expect(r.agentRegistry).toMatchObject({ version: 1 });
    expect(r.pointers).toBe(null);   // no webidCache wired
  });

  it('returns null fields when the pseudo-pod has no replica', async () => {
    const deviceId = 'laptop-anne';
    const pseudoPod = createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'standalone',
      deviceId,
    });
    const r = await restoreFromMnemonic({
      mnemonic: MNEMONIC,
      pseudoPod,
      deviceId,
    });
    expect(r.storageMapping).toBe(null);
    expect(r.agentRegistry).toBe(null);
  });
});

describe('restoreFromMnemonic — webidCache path', () => {
  it('refreshes the cache + reads pointers', async () => {
    let refreshed = 0;
    const fakeCache = {
      refresh: async () => { refreshed++; },
      get pointers() {
        return {
          storageMappingUri: 'https://anne.pod/private/storage-mapping',
          agentRegistryUri:  'https://anne.pod/private/agent-registry',
        };
      },
      webid: 'https://anne.pod/profile#me',
    };

    const r = await restoreFromMnemonic({
      mnemonic:   MNEMONIC,
      webidCache: fakeCache,
    });
    expect(refreshed).toBe(1);
    expect(r.webidUri).toBe('https://anne.pod/profile#me');
    expect(r.pointers.storageMappingUri).toBe('https://anne.pod/private/storage-mapping');
  });

  it('falls back to pseudo-pod when pod fetch fails', async () => {
    const deviceId = 'laptop-anne';
    const pseudoPod = createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'standalone',
      deviceId,
    });
    await pseudoPod.write(
      `pseudo-pod://${deviceId}/private/storage-mapping`,
      { version: 2, mappings: { 'sharing/*': 'pseudo-pod://x/sharing/' } },
    );

    const fakeCache = {
      refresh: async () => {},
      get pointers() {
        return { storageMappingUri: 'https://anne.pod/private/storage-mapping' };
      },
      webid: 'https://anne.pod/profile#me',
    };
    const flakyProv = {
      async getResource() { throw new Error('network'); },
    };
    const fakeOidc = { getAuthenticatedFetch: () => () => Promise.resolve() };

    const r = await restoreFromMnemonic({
      mnemonic:       MNEMONIC,
      webidCache:     fakeCache,
      podProvisioner: flakyProv,
      oidcSession:    fakeOidc,
      pseudoPod,
      deviceId,
    });
    expect(r.storageMapping).toMatchObject({ version: 2 });
  });

  it('prefers pod over pseudo-pod when provisioner succeeds', async () => {
    const deviceId = 'laptop-anne';
    const pseudoPod = createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'standalone',
      deviceId,
    });
    await pseudoPod.write(
      `pseudo-pod://${deviceId}/private/storage-mapping`,
      { version: 2, mappings: { 'from': 'pseudo-pod' } },
    );

    const fakeCache = {
      refresh: async () => {},
      get pointers() {
        return { storageMappingUri: 'https://anne.pod/private/storage-mapping' };
      },
      webid: 'https://anne.pod/profile#me',
    };
    const goodProv = {
      async getResource({ uri }) {
        return { body: { version: 2, mappings: { 'from': 'pod' } }, contentType: 'application/json' };
      },
    };
    const fakeOidc = { getAuthenticatedFetch: () => () => Promise.resolve() };

    const r = await restoreFromMnemonic({
      mnemonic:       MNEMONIC,
      webidCache:     fakeCache,
      podProvisioner: goodProv,
      oidcSession:    fakeOidc,
      pseudoPod,
      deviceId,
    });
    expect(r.storageMapping.mappings.from).toBe('pod');
  });
});

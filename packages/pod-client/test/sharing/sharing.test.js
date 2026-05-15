/**
 * `client.sharing.*` — ACP/WAC sharing primitives.
 *
 * The Inrupt Universal Access API is mocked via `_setInruptModuleForTests`
 * so these tests run in isolation. Integration coverage (real Inrupt
 * SDK + a Solid server) lives at `packages/integration-tests/test/scenarios/sharing-v2/`.
 *
 * Phase 52.16.7 (2026-05-14).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createClientSharing,
  _setInruptModuleForTests,
  SharingUnsupportedError,
  PodClientError,
} from '../../src/index.js';

/** Build a stub authenticated fetch — captures requests for assertion. */
function makeAuthFetch(linkHeader = null) {
  const calls = [];
  const f = async (uri, init = {}) => {
    calls.push({ uri, init });
    if (init.method === 'HEAD') {
      return {
        ok: true,
        headers: {
          get(name) {
            return name.toLowerCase() === 'link' ? linkHeader : null;
          },
        },
      };
    }
    return { ok: true };
  };
  f.calls = calls;
  return f;
}

/** A fake Inrupt module exposing the universalAccess surface. */
function makeFakeInrupt() {
  const log = { setAgent: [], setPublic: [], getAgent: [], getPublic: [] };
  return {
    log,
    universalAccess: {
      setAgentAccess:  async (uri, agent, access, _opts) => {
        log.setAgent.push({ uri, agent, access });
      },
      setPublicAccess: async (uri, access, _opts) => {
        log.setPublic.push({ uri, access });
      },
      getAgentAccess:  async (uri, agent, _opts) => {
        return log.getAgent.find(g => g.uri === uri && g.agent === agent)?.access
          ?? { read: false, append: false, write: false, controlRead: false, controlWrite: false };
      },
      getPublicAccess: async (uri, _opts) => {
        return log.getPublic.find(g => g.uri === uri)?.access
          ?? { read: false, append: false, write: false, controlRead: false, controlWrite: false };
      },
    },
  };
}

const ACP_LINK = '<https://anne.pod/x?ext=acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"';
const WAC_LINK = '<.acl>; rel="acl"';

let inrupt;
beforeEach(() => {
  inrupt = makeFakeInrupt();
  _setInruptModuleForTests(inrupt);
});
afterEach(() => {
  _setInruptModuleForTests(null);
});

describe('createClientSharing — construction', () => {
  it('throws without a fetch', () => {
    expect(() => createClientSharing({})).toThrow(/fetch/);
  });
});

describe('client.sharing.capabilities()', () => {
  it('returns {acp:true, wac:false} for an ACP-supporting pod', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    const caps = await sharing.capabilities({ resourceUri: 'https://anne.pod/notes/x.ttl' });
    expect(caps).toEqual({ acp: true, wac: false });
  });

  it('returns {acp:false, wac:true} for a WAC-only pod', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(WAC_LINK), podRoot: 'https://anne.pod/' });
    const caps = await sharing.capabilities({ resourceUri: 'https://anne.pod/notes/x.ttl' });
    expect(caps).toEqual({ acp: false, wac: true });
  });

  it('caches the result per-origin (single HEAD)', async () => {
    const authFetch = makeAuthFetch(ACP_LINK);
    const sharing = createClientSharing({ fetch: authFetch, podRoot: 'https://anne.pod/' });
    await sharing.capabilities({ resourceUri: 'https://anne.pod/notes/x' });
    await sharing.capabilities({ resourceUri: 'https://anne.pod/notes/y' });
    await sharing.capabilities({ resourceUri: 'https://anne.pod/other.ttl' });
    expect(authFetch.calls.filter(c => c.init.method === 'HEAD')).toHaveLength(1);
  });

  it('accepts containerUri shape', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    const caps = await sharing.capabilities({ containerUri: 'https://anne.pod/shared' });
    expect(caps.acp).toBe(true);
  });

  it('throws on missing target', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    await expect(sharing.capabilities({})).rejects.toThrow(/one of/);
  });
});

describe('client.sharing.grant()', () => {
  it('calls universalAccess.setAgentAccess for an agent grant', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    const result = await sharing.grant({
      resourceUri: 'https://anne.pod/notes/x.ttl',
      agent:       'https://bob.pod/profile#me',
      modes:       ['read'],
    });
    expect(inrupt.log.setAgent).toHaveLength(1);
    expect(inrupt.log.setAgent[0]).toMatchObject({
      uri:   'https://anne.pod/notes/x.ttl',
      agent: 'https://bob.pod/profile#me',
      access: { read: true, append: false, write: false, controlRead: false, controlWrite: false },
    });
    expect(result).toMatchObject({
      targetUri: 'https://anne.pod/notes/x.ttl',
      kind:      'resource',
      subject:   'agent',
      agent:     'https://bob.pod/profile#me',
      modes:     ['read'],
      mode:      'acp',
    });
  });

  it('calls universalAccess.setPublicAccess for a public grant', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    const result = await sharing.grant({
      resourceUri: 'https://anne.pod/notes/x.ttl',
      public:      true,
      modes:       ['read'],
    });
    expect(inrupt.log.setPublic).toHaveLength(1);
    expect(result.subject).toBe('public');
    expect(result).not.toHaveProperty('agent');
  });

  it('translates control mode to controlRead + controlWrite', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    await sharing.grant({
      resourceUri: 'https://anne.pod/x',
      agent:       'https://bob.pod/profile#me',
      modes:       ['control'],
    });
    expect(inrupt.log.setAgent[0].access).toEqual({
      read: false, append: false, write: false, controlRead: true, controlWrite: true,
    });
  });

  it('normalises containerUri to trailing slash', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    const result = await sharing.grant({
      containerUri: 'https://anne.pod/shared',
      agent:        'https://bob.pod/profile#me',
      modes:        ['read'],
    });
    expect(result.targetUri).toBe('https://anne.pod/shared/');
    expect(result.kind).toBe('container');
    expect(inrupt.log.setAgent[0].uri).toBe('https://anne.pod/shared/');
  });

  it('returns mode=wac on a WAC-only pod', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(WAC_LINK), podRoot: 'https://anne.pod/' });
    const result = await sharing.grant({
      resourceUri: 'https://anne.pod/notes/x.ttl',
      agent:       'https://bob.pod/profile#me',
      modes:       ['read'],
    });
    expect(result.mode).toBe('wac');
  });

  it('throws SharingUnsupportedError when neither ACP nor WAC available', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(null), podRoot: 'https://anne.pod/' });
    await expect(sharing.grant({
      resourceUri: 'https://anne.pod/x',
      agent:       'https://bob.pod/profile#me',
      modes:       ['read'],
    })).rejects.toThrow(SharingUnsupportedError);
  });

  it('throws on conflicting subject (both agent + public)', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    await expect(sharing.grant({
      resourceUri: 'https://anne.pod/x',
      agent:       'https://bob.pod/profile#me',
      public:      true,
      modes:       ['read'],
    })).rejects.toThrow(/exactly one of/);
  });

  it('throws on missing subject', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    await expect(sharing.grant({
      resourceUri: 'https://anne.pod/x',
      modes:       ['read'],
    })).rejects.toThrow(/one of \{agent, public/);
  });

  it('throws on unknown mode', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    await expect(sharing.grant({
      resourceUri: 'https://anne.pod/x',
      agent:       'https://bob.pod/profile#me',
      modes:       ['publish'],
    })).rejects.toThrow(/unknown mode/);
  });

  it('defers groups with NOT_IMPLEMENTED', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    await expect(sharing.grant({
      resourceUri: 'https://anne.pod/x',
      group:       'https://anne.pod/groups/family#group',
      modes:       ['read'],
    })).rejects.toThrow(/group grants are not implemented/);
  });

  it('throws when @inrupt/solid-client is missing universalAccess', async () => {
    _setInruptModuleForTests({});  // empty module — no universalAccess
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    await expect(sharing.grant({
      resourceUri: 'https://anne.pod/x',
      agent:       'https://bob.pod/profile#me',
      modes:       ['read'],
    })).rejects.toThrow(/universalAccess/);
  });
});

describe('client.sharing.revoke()', () => {
  it('sets all modes to false on revoke', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    await sharing.revoke({
      resourceUri: 'https://anne.pod/notes/x.ttl',
      agent:       'https://bob.pod/profile#me',
    });
    expect(inrupt.log.setAgent[0].access).toEqual({
      read: false, append: false, write: false, controlRead: false, controlWrite: false,
    });
  });

  it('revokes public access', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    const r = await sharing.revoke({
      resourceUri: 'https://anne.pod/notes/x.ttl',
      public:      true,
    });
    expect(inrupt.log.setPublic).toHaveLength(1);
    expect(r.subject).toBe('public');
  });

  it('throws SharingUnsupportedError when pod has no ACP/WAC', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(null), podRoot: 'https://anne.pod/' });
    await expect(sharing.revoke({
      resourceUri: 'https://anne.pod/x',
      agent:       'https://bob.pod/profile#me',
    })).rejects.toThrow(SharingUnsupportedError);
  });
});

describe('client.sharing.list()', () => {
  it('returns the public entry when public access is granted', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    await sharing.grant({
      resourceUri: 'https://anne.pod/notes/x.ttl',
      public:      true,
      modes:       ['read'],
    });
    // Seed the fake `getPublicAccess` to mirror the grant.
    inrupt.log.getPublic.push({
      uri: 'https://anne.pod/notes/x.ttl',
      access: { read: true, append: false, write: false, controlRead: false, controlWrite: false },
    });
    const shares = await sharing.list({ resourceUri: 'https://anne.pod/notes/x.ttl' });
    expect(shares).toContainEqual({ subject: 'public', modes: ['read'] });
  });

  it('queries listed agents when agentsToQuery is passed', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    inrupt.log.getAgent.push({
      uri:    'https://anne.pod/x',
      agent:  'https://bob.pod/profile#me',
      access: { read: true, append: false, write: false, controlRead: false, controlWrite: false },
    });
    const shares = await sharing.list({
      resourceUri:    'https://anne.pod/x',
      agentsToQuery:  ['https://bob.pod/profile#me'],
    });
    expect(shares).toContainEqual({
      subject: 'agent',
      agent:   'https://bob.pod/profile#me',
      modes:   ['read'],
    });
  });

  it('returns [] when nothing is granted', async () => {
    const sharing = createClientSharing({ fetch: makeAuthFetch(ACP_LINK), podRoot: 'https://anne.pod/' });
    expect(await sharing.list({ resourceUri: 'https://anne.pod/x' })).toEqual([]);
  });
});

describe('PodClient.sharing (lazy wiring)', () => {
  it('lazily builds the sharing namespace on first access', async () => {
    const { PodClient } = await import('../../src/index.js');
    // Stub auth — just exposes getAuthenticatedFetch returning our fake.
    const fakeFetch = makeAuthFetch(ACP_LINK);
    const client = new PodClient({
      podRoot: 'https://anne.pod/',
      auth: { getAuthenticatedFetch: () => fakeFetch, identity: () => 'test', close() {} },
      podSourceFactory: () => ({
        read: async () => null, write: async () => null, list: async () => ({ container: '', entries: [] }),
        delete: async () => null, exists: async () => false,
      }),
    });
    const a = client.sharing;
    const b = client.sharing;
    expect(a).toBe(b);  // memoised
    expect(typeof a.grant).toBe('function');
    expect(typeof a.revoke).toBe('function');
    expect(typeof a.list).toBe('function');
    expect(typeof a.capabilities).toBe('function');
  });
});

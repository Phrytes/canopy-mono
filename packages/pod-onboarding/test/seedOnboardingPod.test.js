/**
 * seedOnboardingPod — composition coverage against a recording mock
 * podClient (no live pod).
 *
 * Asserts: all initial resources written + ACP templates applied in the
 * right order; idempotent re-seed is a no-op; a mid-way write failure
 * surfaces a coded error and (in a seed→register flow) leaves NO
 * half-registered instance.
 */

import { describe, it, expect } from 'vitest';
import { seedOnboardingPod }     from '../src/seedOnboardingPod.js';
import { createCustomerRegister } from '../src/customerRegister.js';

const POD   = 'https://acme-household.pod';
const WEBID = 'https://acme-household.pod/profile/card#me';

const AGENT_INFO = {
  deviceId: 'hub-acme',
  agentUri: 'agent://acme/hub',
  pubKey:   'BASE64PUBKEY==',
};

/**
 * Recording mock podClient. Stores every put/setAcp so `get`/`has`
 * report existence (drives idempotency). `failOn` forces a mid-way
 * failure on the Nth matching write.
 */
function recordingPodClient({ failKind } = {}) {
  const puts   = [];
  const acps   = [];
  const store  = new Map();
  const patches = [];
  return {
    puts, acps, store, patches,
    async put({ uri, body, contentType }) {
      if (failKind === 'put' || (typeof failKind === 'function' && failKind({ uri }))) {
        throw new Error('boom: network');
      }
      puts.push({ uri, body, contentType });
      store.set(uri, body);
    },
    async setAcp({ uri, acp }) {
      if (failKind === 'acp') throw new Error('boom: acp');
      acps.push({ uri, acp });
      store.set(uri, { __acp: acp });
    },
    async get(uri) { return store.has(uri) ? store.get(uri) : null; },
  };
}

describe('seedOnboardingPod — input validation', () => {
  it('requires a podClient with put/write', async () => {
    await expect(seedOnboardingPod({
      podClient: {}, podUri: POD, deviceId: 'd', agentInfo: AGENT_INFO,
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
  it('requires podUri', async () => {
    await expect(seedOnboardingPod({
      podClient: recordingPodClient(), deviceId: 'd', agentInfo: AGENT_INFO,
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
  it('requires deviceId', async () => {
    await expect(seedOnboardingPod({
      podClient: recordingPodClient(), podUri: POD, agentInfo: AGENT_INFO,
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
  it('requires agentInfo', async () => {
    await expect(seedOnboardingPod({
      podClient: recordingPodClient(), podUri: POD, deviceId: 'd',
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('seedOnboardingPod — happy path', () => {
  it('writes all initial resources + applies the three ACP templates', async () => {
    const pod = recordingPodClient();
    const result = await seedOnboardingPod({
      podClient: pod, podUri: POD, deviceId: 'hub-acme', agentInfo: AGENT_INFO,
    });

    expect(result.ok).toBe(true);
    expect(result.podUri).toBe(POD);
    expect(result.agentWebid).toBe(WEBID);

    // Three resource PUTs, in order.
    const putUris = pod.puts.map(p => p.uri);
    expect(putUris).toEqual([
      'https://acme-household.pod/private/storage-mapping',
      'https://acme-household.pod/private/agent-registry',
      'https://acme-household.pod/profile/card',
    ]);

    // storage-mapping + agent-registry bodies came from the builders.
    expect(pod.puts[0].body.mappings['private/*']).toBe('https://acme-household.pod/private/');
    expect(pod.puts[1].body.agents).toHaveLength(1);
    expect(pod.puts[1].body.agents[0].webid).toBe(WEBID);

    // Three ACP templates, correct containers + owner-matcher = webid.
    expect(pod.acps.map(a => a.uri)).toEqual([
      'https://acme-household.pod/private/',
      'https://acme-household.pod/sharing/',
      'https://acme-household.pod/sharing/public/',
    ]);
    for (const a of pod.acps) {
      const owner = a.acp.policies.find(p => p.matchers.some(m => m.agent === WEBID));
      expect(owner).toBeTruthy();
    }
    // public container also has a PublicAgent read matcher.
    const publicAcp = pod.acps.find(a => a.uri.endsWith('/sharing/public/')).acp;
    expect(publicAcp.policies.some(p => p.matchers.some(m => m.publicAgent === true))).toBe(true);

    // Summary lists every resource as written.
    expect(result.resources.every(r => r.status === 'written')).toBe(true);
    expect(result.resources).toHaveLength(6); // 3 resources + 3 acps
  });

  it('derives agentWebid from podUri when agentInfo.webid absent, honours it when present', async () => {
    const pod = recordingPodClient();
    const r = await seedOnboardingPod({
      podClient: pod, podUri: POD, deviceId: 'hub-acme',
      agentInfo: { ...AGENT_INFO, webid: 'https://acme-household.pod/profile/card#owner' },
    });
    expect(r.agentWebid).toBe('https://acme-household.pod/profile/card#owner');
  });

  it('supports a write(uri, body) podClient (fallback writer, no ACP)', async () => {
    const writes = [];
    const podClient = { async write(uri, body) { writes.push({ uri, body }); } };
    const r = await seedOnboardingPod({
      podClient, podUri: POD, deviceId: 'd', agentInfo: AGENT_INFO,
    });
    expect(r.ok).toBe(true);
    expect(writes.map(w => w.uri)).toEqual([
      'https://acme-household.pod/private/storage-mapping',
      'https://acme-household.pod/private/agent-registry',
      'https://acme-household.pod/profile/card',
    ]);
  });

  it('uses patchWebidProfile when the podClient exposes it', async () => {
    const pod = recordingPodClient();
    pod.patchWebidProfile = async (args) => { pod.patches.push(args); };
    await seedOnboardingPod({
      podClient: pod, podUri: POD, deviceId: 'hub-acme', agentInfo: AGENT_INFO,
    });
    expect(pod.patches).toHaveLength(1);
    expect(pod.patches[0].webidUri).toBe(WEBID);
    expect(pod.patches[0].pointers.storageMappingUri)
      .toBe('https://acme-household.pod/private/storage-mapping');
    // profile no longer among the plain PUTs.
    expect(pod.puts.map(p => p.uri)).toEqual([
      'https://acme-household.pod/private/storage-mapping',
      'https://acme-household.pod/private/agent-registry',
    ]);
  });
});

describe('seedOnboardingPod — idempotency', () => {
  it('re-seeding an already-seeded pod is a no-op (all skipped)', async () => {
    const pod = recordingPodClient();
    await seedOnboardingPod({ podClient: pod, podUri: POD, deviceId: 'hub-acme', agentInfo: AGENT_INFO });
    const putsAfterFirst = pod.puts.length;
    const acpsAfterFirst = pod.acps.length;

    const second = await seedOnboardingPod({
      podClient: pod, podUri: POD, deviceId: 'hub-acme', agentInfo: AGENT_INFO,
    });
    // No new writes / acps.
    expect(pod.puts.length).toBe(putsAfterFirst);
    expect(pod.acps.length).toBe(acpsAfterFirst);
    expect(second.resources.every(r => r.status === 'skipped')).toBe(true);
    expect(second.ok).toBe(true);
  });
});

describe('seedOnboardingPod — failure handling', () => {
  it('surfaces a coded SEED_WRITE_FAILED on a resource write failure', async () => {
    const pod = recordingPodClient({ failKind: 'put' });
    await expect(seedOnboardingPod({
      podClient: pod, podUri: POD, deviceId: 'd', agentInfo: AGENT_INFO,
    })).rejects.toMatchObject({ code: 'SEED_WRITE_FAILED', kind: 'storage-mapping' });
  });

  it('surfaces a coded SEED_WRITE_FAILED on an ACP failure', async () => {
    const pod = recordingPodClient({ failKind: 'acp' });
    await expect(seedOnboardingPod({
      podClient: pod, podUri: POD, deviceId: 'd', agentInfo: AGENT_INFO,
    })).rejects.toMatchObject({ code: 'SEED_WRITE_FAILED', kind: 'acp:private' });
  });

  it('a mid-way seed failure leaves NO half-registered instance', async () => {
    // Fail on the agent-registry write (the 2nd resource).
    const pod = recordingPodClient({
      failKind: ({ uri }) => uri.endsWith('/private/agent-registry'),
    });
    const register = createCustomerRegister({ now: () => '2026-07-06T00:00:00.000Z' });

    // Caller flow: seed FIRST, register only on success.
    let seededOk = false;
    try {
      await seedOnboardingPod({ podClient: pod, podUri: POD, deviceId: 'd', agentInfo: AGENT_INFO });
      seededOk = true;
      await register.register({ customerId: 'acme', podUri: POD, agentWebid: WEBID });
    } catch (err) {
      expect(err.code).toBe('SEED_WRITE_FAILED');
      expect(err.kind).toBe('agent-registry');
    }
    expect(seededOk).toBe(false);
    // Register never touched → no instance.
    expect(await register.get('acme')).toBeNull();
    expect(await register.list()).toHaveLength(0);
  });
});

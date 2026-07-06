import { describe, it, expect } from 'vitest';
import { createPodAcl } from '../src/adapters/podAcl.js';

const WEBID = 'https://anne.pod/profile/card#me';
const OTHER = 'https://mallory.pod/profile/card#me';
const RES   = 'https://anne.pod/media/photo-item';

/** Mock `client.sharing` with a canned grant list keyed by resourceUri. */
function mockSharing(grantsByResource, { throwOn } = {}) {
  const calls = [];
  return {
    calls,
    async list({ resourceUri, agentsToQuery } = {}) {
      calls.push({ resourceUri, agentsToQuery });
      if (throwOn && resourceUri === throwOn) throw new Error('sharing.list boom');
      return grantsByResource[resourceUri] ?? [];
    },
  };
}

describe('createPodAcl — canRead via sharing.list (deny-by-default)', () => {
  it('true when the agent has a read grant', async () => {
    const sharing = mockSharing({ [RES]: [{ subject: 'agent', agent: WEBID, modes: ['read'] }] });
    const acl = createPodAcl({ sharing, resolveResourceUri: () => RES });
    expect(await acl.canRead(WEBID, 'blob://k1')).toBe(true);
    // It queried the pod about THIS agent + the resolved resource.
    expect(sharing.calls[0]).toEqual({ resourceUri: RES, agentsToQuery: [WEBID] });
  });

  it('false when the agent has no grant (deny-by-default)', async () => {
    const sharing = mockSharing({ [RES]: [{ subject: 'agent', agent: WEBID, modes: ['read'] }] });
    const acl = createPodAcl({ sharing, resolveResourceUri: () => RES });
    expect(await acl.canRead(OTHER, 'blob://k1')).toBe(false);
  });

  it('false when the grant lacks the read mode (e.g. write-only)', async () => {
    const sharing = mockSharing({ [RES]: [{ subject: 'agent', agent: WEBID, modes: ['write', 'append'] }] });
    const acl = createPodAcl({ sharing, resolveResourceUri: () => RES });
    expect(await acl.canRead(WEBID, 'blob://k1')).toBe(false);
  });

  it('true for a public read grant, for any agent', async () => {
    const sharing = mockSharing({ [RES]: [{ subject: 'public', modes: ['read'] }] });
    const acl = createPodAcl({ sharing, resolveResourceUri: () => RES });
    expect(await acl.canRead(OTHER, 'blob://k1')).toBe(true);
  });

  it('false (never throws) when sharing.list throws', async () => {
    const sharing = mockSharing({}, { throwOn: RES });
    const acl = createPodAcl({ sharing, resolveResourceUri: () => RES });
    expect(await acl.canRead(WEBID, 'blob://k1')).toBe(false);
  });

  it('false when the ref cannot be resolved to a pod resource', async () => {
    const sharing = mockSharing({});
    const acl = createPodAcl({ sharing, resolveResourceUri: () => null });
    expect(await acl.canRead(WEBID, 'blob://k1')).toBe(false);
    expect(sharing.calls).toHaveLength(0); // short-circuits before hitting the pod
  });

  it('false for a falsy webId', async () => {
    const sharing = mockSharing({ [RES]: [{ subject: 'public', modes: ['read'] }] });
    const acl = createPodAcl({ sharing, resolveResourceUri: () => RES });
    expect(await acl.canRead(undefined, 'blob://k1')).toBe(false);
  });

  it('default resolver treats an http(s) ref as its own resource', async () => {
    const sharing = mockSharing({ [RES]: [{ subject: 'agent', agent: WEBID, modes: ['read'] }] });
    const acl = createPodAcl({ sharing });
    expect(await acl.canRead(WEBID, RES)).toBe(true);
    // A blob:// ref with no resolver is unresolvable → deny.
    expect(await acl.canRead(WEBID, 'blob://k1')).toBe(false);
  });

  it('requires a sharing surface with list()', () => {
    expect(() => createPodAcl({})).toThrow(/sharing/);
  });
});

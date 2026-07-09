/**
 * Resource shape + URI derivation.
 */

import { describe, it, expect } from 'vitest';
import {
  registryResourceUri,
  normaliseResource,
  emptyResource,
  RESOURCE_VERSION,
} from '../src/resource.js';

describe('registryResourceUri', () => {
  it('prefers the pseudo-pod path when deviceId is supplied (V0 default)', () => {
    // V0: pseudo-pod is the authoritative store; pod-side mirroring is V1
    // cache-mode work. deviceId wins even when anchorPodUri is also present.
    expect(registryResourceUri({ deviceId: 'laptop-anne' }))
      .toBe('pseudo-pod://laptop-anne/private/agent-registry');
    expect(registryResourceUri({ anchorPodUri: 'https://anne.pod', deviceId: 'laptop-anne' }))
      .toBe('pseudo-pod://laptop-anne/private/agent-registry');
  });

  it('falls back to the anchor-pod path when only anchorPodUri is supplied', () => {
    expect(registryResourceUri({ anchorPodUri: 'https://anne.pod' }))
      .toBe('https://anne.pod/private/agent-registry');
    expect(registryResourceUri({ anchorPodUri: 'https://anne.pod/' }))
      .toBe('https://anne.pod/private/agent-registry');
  });

  it('preferPodUri forces the https:// path when both are given', () => {
    expect(registryResourceUri({
      anchorPodUri:  'https://anne.pod',
      deviceId:      'laptop-anne',
      preferPodUri:  true,
    })).toBe('https://anne.pod/private/agent-registry');
  });

  it('throws when neither pod nor device is supplied', () => {
    expect(() => registryResourceUri({})).toThrow();
  });
});

describe('emptyResource / normaliseResource', () => {
  it('emptyResource is a frozen v=1 record', () => {
    const r = emptyResource();
    expect(r.v).toBe(RESOURCE_VERSION);
    expect(r.agents).toEqual([]);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.agents)).toBe(true);
  });

  it('normaliseResource handles bad input', () => {
    expect(normaliseResource(null).v).toBe(RESOURCE_VERSION);
    expect(normaliseResource('not-an-object').agents).toEqual([]);
  });

  it('normaliseResource fills in missing per-agent fields', () => {
    const r = normaliseResource({
      v: 1,
      agents: [{ agentId: 'a', pubKey: 'p', agentUri: 'u' }],
      updatedAt: '2026-05-11T10:00:00Z',
    });
    expect(r.agents[0]).toMatchObject({
      agentId:  'a',
      pubKey:   'p',
      agentUri: 'u',
      role:     'device',
      capabilities: [],
      revokedAt: null,
    });
    expect(Object.isFrozen(r.agents[0])).toBe(true);
  });

  it('round-trips a grants[] value (not dropped by the allowlist)', () => {
    const r = normaliseResource({
      v: RESOURCE_VERSION,
      agents: [{
        agentId: 'a', pubKey: 'p', agentUri: 'u',
        capabilities: ['tasks'],
        grants: [
          { tokenId: 'tok-1', skill: 'tasks.create', expiresAt: '2027-01-01T00:00:00Z', subject: 's', capability: 'tasks' },
          { /* no tokenId */ skill: 'dropped', capability: 'x' },
        ],
      }],
      updatedAt: '2026-05-11T10:00:00Z',
    });
    // Valid grant survives; the tokenId-less one is dropped by the allowlist.
    expect(r.agents[0].grants).toHaveLength(1);
    expect(r.agents[0].grants[0]).toMatchObject({
      tokenId: 'tok-1', skill: 'tasks.create', capability: 'tasks',
    });
    expect(Object.isFrozen(r.agents[0].grants)).toBe(true);
    expect(Object.isFrozen(r.agents[0].grants[0])).toBe(true);
  });

  it('migrates an older (v1) resource with no grants field → grants: []', () => {
    const r = normaliseResource({
      v: 1,
      agents: [{ agentId: 'a', pubKey: 'p', agentUri: 'u', capabilities: ['tasks'] }],
      updatedAt: '2026-05-11T10:00:00Z',
    });
    expect(r.agents[0].grants).toEqual([]);
    expect(Object.isFrozen(r.agents[0].grants)).toBe(true);
  });
});

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
  it('returns the pod path for pod-having users', () => {
    expect(registryResourceUri({ anchorPodUri: 'https://anne.pod' }))
      .toBe('https://anne.pod/private/agent-registry');
    expect(registryResourceUri({ anchorPodUri: 'https://anne.pod/' }))
      .toBe('https://anne.pod/private/agent-registry');
  });

  it('returns the pseudo-pod path for no-pod users', () => {
    expect(registryResourceUri({ deviceId: 'laptop-anne' }))
      .toBe('pseudo-pod://laptop-anne/private/agent-registry');
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
});

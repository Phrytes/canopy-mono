/**
 * defaultPolicy — build defaults for pod-having and no-pod users.
 */

import { describe, it, expect } from 'vitest';
import { buildDefaultPolicy } from '../src/defaultPolicy.js';

describe('buildDefaultPolicy — pod-having user', () => {
  it('routes private/sharing to the anchor pod', () => {
    const p = buildDefaultPolicy({
      anchorPodUri: 'https://anne.pod',
      deviceId:     'laptop-anne',
    });
    expect(p.mappings).toMatchObject({
      'private/*':              'https://anne.pod/private/',
      'sharing/*':              'https://anne.pod/sharing/',
      'sharing/profile-public': 'https://anne.pod/sharing/public/profile-card',
      'personal-in-group/*':    'https://anne.pod/personal-in-group/',
    });
    // group routing defaults to pseudo-pod, overridden per-circle by circlePolicies.
    expect(p.mappings['group/*']).toBe('pseudo-pod://laptop-anne/group/');
  });

  it('default circle policy is centralised on the anchor pod', () => {
    const p = buildDefaultPolicy({
      anchorPodUri: 'https://anne.pod',
      deviceId:     'laptop-anne',
    });
    expect(p.circlePolicyDefault).toEqual({
      policy:      'centralised',
      groupPodUri: 'https://anne.pod',
    });
  });

  it('strips trailing slash from anchor pod URI', () => {
    const p = buildDefaultPolicy({
      anchorPodUri: 'https://anne.pod/',
      deviceId:     'laptop-anne',
    });
    expect(p.mappings['private/*']).toBe('https://anne.pod/private/');
  });
});

describe('buildDefaultPolicy — no-pod user', () => {
  it('routes everything to the device-local pseudo-pod', () => {
    const p = buildDefaultPolicy({
      anchorPodUri: null,
      deviceId:     'laptop-no-pod',
    });
    expect(p.mappings).toMatchObject({
      'private/*':              'pseudo-pod://laptop-no-pod/private/',
      'sharing/*':              'pseudo-pod://laptop-no-pod/sharing/',
      'sharing/profile-public': 'pseudo-pod://laptop-no-pod/sharing/public/profile-card',
      'group/*':                'pseudo-pod://laptop-no-pod/group/',
      'personal-in-group/*':    'pseudo-pod://laptop-no-pod/personal-in-group/',
    });
  });

  it('default circle policy is no-pod', () => {
    const p = buildDefaultPolicy({
      anchorPodUri: null,
      deviceId:     'laptop-no-pod',
    });
    expect(p.circlePolicyDefault).toEqual({ policy: 'no-pod' });
  });

  it('treats undefined anchorPodUri the same as null', () => {
    const p = buildDefaultPolicy({ deviceId: 'd' });
    expect(p.circlePolicyDefault).toEqual({ policy: 'no-pod' });
    expect(p.mappings['private/*']).toBe('pseudo-pod://d/private/');
  });
});

describe('buildDefaultPolicy — input validation', () => {
  it('throws on missing deviceId', () => {
    expect(() => buildDefaultPolicy({ anchorPodUri: 'x' })).toThrow(/deviceId/);
    expect(() => buildDefaultPolicy({ deviceId: '' })).toThrow(/deviceId/);
  });
});

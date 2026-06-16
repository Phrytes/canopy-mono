/**
 * circleStoragePolicy — the bridge from the circle `pod` axis to stoop's
 * authoritative four-tier crew storage policy. Pure mapping + call
 * orchestration over a fake callSkill (no pod, no network).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  POD_TO_TIER, TIER_TO_POD, podAxisToTier, tierToPodAxis,
  loadCircleStoragePod, pushCircleStoragePolicy,
} from '../../src/v2/circleStoragePolicy.js';

describe('pod ↔ tier mapping', () => {
  it('maps the four pod values to the four stoop tiers (1:1, round-trips)', () => {
    expect(POD_TO_TIER).toEqual({ none: 'no-pod', shared: 'centralised', personal: 'decentralised', hybrid: 'hybrid' });
    for (const pod of Object.keys(POD_TO_TIER)) {
      expect(tierToPodAxis(podAxisToTier(pod))).toBe(pod);
    }
    for (const tier of Object.keys(TIER_TO_POD)) {
      expect(podAxisToTier(tierToPodAxis(tier))).toBe(tier);
    }
  });
  it('defaults unknown values safely', () => {
    expect(podAxisToTier('bogus')).toBe('no-pod');
    expect(tierToPodAxis('bogus')).toBe('none');
  });
});

describe('pushCircleStoragePolicy', () => {
  it('calls stoop.setCrewStoragePolicy with the mapped tier + circleId as groupId', async () => {
    const callSkill = vi.fn(async () => ({ groupId: 'c-1', storage: { policy: 'centralised', groupPodUri: 'https://pod/' } }));
    const r = await pushCircleStoragePolicy({ callSkill, circleId: 'c-1', pod: 'shared', groupPodUri: 'https://pod/' });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'setCrewStoragePolicy', {
      groupId: 'c-1', storagePolicy: 'centralised', groupPodUri: 'https://pod/',
    });
    expect(r).toEqual({ ok: true, storage: { policy: 'centralised', groupPodUri: 'https://pod/' } });
  });

  it('omits groupPodUri when not supplied (e.g. decentralised)', async () => {
    const callSkill = vi.fn(async () => ({ storage: { policy: 'decentralised' } }));
    await pushCircleStoragePolicy({ callSkill, circleId: 'c-1', pod: 'personal' });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'setCrewStoragePolicy', { groupId: 'c-1', storagePolicy: 'decentralised' });
  });

  it('surfaces the one-way downgrade rejection verbatim', async () => {
    const callSkill = vi.fn(async () => ({ error: 'storage-policy-downgrade-not-supported' }));
    const r = await pushCircleStoragePolicy({ callSkill, circleId: 'c-1', pod: 'none' });
    expect(r).toEqual({ ok: false, error: 'storage-policy-downgrade-not-supported' });
  });

  it('surfaces the admin-only rejection', async () => {
    const callSkill = vi.fn(async () => ({ error: 'admin-only' }));
    const r = await pushCircleStoragePolicy({ callSkill, circleId: 'c-1', pod: 'shared', groupPodUri: 'https://pod/' });
    expect(r).toEqual({ ok: false, error: 'admin-only' });
  });

  it('guards missing inputs', async () => {
    expect(await pushCircleStoragePolicy({})).toEqual({ ok: false, error: 'no-callskill' });
    expect(await pushCircleStoragePolicy({ callSkill: vi.fn() })).toEqual({ ok: false, error: 'groupId required' });
  });

  it('catches a throwing callSkill', async () => {
    const callSkill = vi.fn(async () => { throw new Error('boom'); });
    const r = await pushCircleStoragePolicy({ callSkill, circleId: 'c-1', pod: 'shared' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/storage-policy-write-failed:boom/);
  });
});

describe('loadCircleStoragePod', () => {
  it('reads stoop.getCrewStoragePolicy and hydrates the pod axis', async () => {
    const callSkill = vi.fn(async () => ({ policy: 'decentralised', groupPodUri: null }));
    const r = await loadCircleStoragePod({ callSkill, circleId: 'c-1' });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'getCrewStoragePolicy', { groupId: 'c-1' });
    expect(r).toEqual({ pod: 'personal', groupPodUri: null });
  });

  it('returns null on error / missing inputs (form keeps its local value)', async () => {
    expect(await loadCircleStoragePod({})).toBeNull();
    expect(await loadCircleStoragePod({ callSkill: vi.fn(async () => ({ error: 'groupId required' })), circleId: 'c-1' })).toBeNull();
    expect(await loadCircleStoragePod({ callSkill: vi.fn(async () => { throw new Error('x'); }), circleId: 'c-1' })).toBeNull();
  });
});

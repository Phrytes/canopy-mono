/**
 * MemberMap.fromPodConfig — pod-backed roster loader (Phase 4 of the
 * substrate-vs-SDK refactor; H5-V2-resume.md step 2).
 *
 * Composes `@canopy/pod-client.PodClient` via runtime injection
 * (duck-typed `podClient.read({decode:'json'})`).  These tests use a
 * minimal fake PodClient that mirrors `pod-client`'s read contract.
 */

import { describe, it, expect } from 'vitest';
import { MemberMap } from '../src/MemberMap.js';

const ALICE = 'https://id.example/alice';
const BOB   = 'https://id.example/bob';
const CONFIG_URI = 'https://pod.example/group-h5/config.json';

/** Minimal duck-typed fake PodClient — matches the substrate's contract. */
function fakePodClient(reader) {
  return { read: reader };
}

describe('MemberMap.fromPodConfig', () => {
  it('reads the pod config and populates the map', async () => {
    const podClient = fakePodClient(async (uri) => {
      expect(uri).toBe(CONFIG_URI);
      return {
        content: {
          members: [
            { webid: ALICE, displayName: 'Alice', pubKey: 'alice-pk', role: 'admin' },
            { webid: BOB,   displayName: 'Bob',   pubKey: 'bob-pk' },
          ],
        },
      };
    });
    const members = await MemberMap.fromPodConfig({ podClient, configUri: CONFIG_URI });
    const alice = await members.resolveByWebid(ALICE);
    expect(alice).toMatchObject({
      webid: ALICE, displayName: 'Alice', pubKey: 'alice-pk', role: 'admin',
    });
    const bob = await members.resolveByWebid(BOB);
    expect(bob).toMatchObject({
      webid: BOB, pubKey: 'bob-pk', role: null,
    });
  });

  it('parses string content (when PodClient hands raw JSON, not parsed)', async () => {
    const podClient = fakePodClient(async () => ({
      content: JSON.stringify({
        members: [{ webid: ALICE, displayName: 'Alice' }],
      }),
    }));
    const members = await MemberMap.fromPodConfig({ podClient, configUri: CONFIG_URI });
    expect(await members.resolveByWebid(ALICE)).toMatchObject({ webid: ALICE });
  });

  it('returns empty map when content has no `members` array', async () => {
    const podClient = fakePodClient(async () => ({ content: { other: 'stuff' } }));
    const members = await MemberMap.fromPodConfig({ podClient, configUri: CONFIG_URI });
    expect(await members.list()).toEqual([]);
  });

  it('NOT_FOUND with fallback returns empty / fallback roster', async () => {
    const podClient = fakePodClient(async () => {
      throw Object.assign(new Error('pod 404'), { code: 'NOT_FOUND' });
    });
    const members = await MemberMap.fromPodConfig({
      podClient,
      configUri: CONFIG_URI,
      fallback: [{ webid: ALICE }],
    });
    expect(await members.resolveByWebid(ALICE)).toMatchObject({ webid: ALICE });
  });

  it('NOT_FOUND without fallback rethrows', async () => {
    const podClient = fakePodClient(async () => {
      throw Object.assign(new Error('pod 404'), { code: 'NOT_FOUND' });
    });
    await expect(
      MemberMap.fromPodConfig({ podClient, configUri: CONFIG_URI }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('non-NOT_FOUND error always rethrows (even with fallback)', async () => {
    const podClient = fakePodClient(async () => {
      throw Object.assign(new Error('boom'), { code: 'SERVER_ERROR' });
    });
    await expect(
      MemberMap.fromPodConfig({
        podClient,
        configUri: CONFIG_URI,
        fallback: [],
      }),
    ).rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('rejects without a podClient', async () => {
    await expect(
      MemberMap.fromPodConfig({ configUri: CONFIG_URI }),
    ).rejects.toThrow(/podClient with read.*required/);
  });

  it('rejects without a configUri', async () => {
    await expect(
      MemberMap.fromPodConfig({ podClient: fakePodClient(async () => ({})) }),
    ).rejects.toThrow(/configUri required/);
  });

  it('honours pubKey slot end-to-end (L1e cross-substrate requirement)', async () => {
    const podClient = fakePodClient(async () => ({
      content: { members: [{ webid: ALICE, pubKey: 'alice-pk' }] },
    }));
    const members = await MemberMap.fromPodConfig({ podClient, configUri: CONFIG_URI });
    const all = await members.list();
    expect(all[0].pubKey).toBe('alice-pk');
  });
});

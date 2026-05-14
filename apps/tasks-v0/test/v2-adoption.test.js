/**
 * Tasks V2 standardisation adoption (2026-05-14).
 *
 * Covers:
 *   - `addTask({embeds: [{type, ref}, ...]})` persists embeds on the
 *     stored task; cap of 8; validates entries.
 *   - `crewConfig.storage` carries the §II.2 policy. Default
 *     `'no-pod'`. Centralised/hybrid honour a `groupPodUri`.
 *   - `getCrewStoragePolicy` reads from `liveCrew.storage`.
 *   - `setCrewStoragePolicy` upgrades the policy; admin-only; one-way
 *     (rejects downgrade to no-pod once pod-having).
 */

import { describe, it, expect } from 'vitest';
import { DataPart } from '@canopy/core';
import { createCrewAgent } from '../src/Crew.js';
import { buildBundle } from '../src/storage/buildBundle.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

async function makeCrew(storage) {
  const bundle = buildBundle();
  const crew = await createCrewAgent({
    crewConfig: {
      crewId:  'oss-tools',
      name:    'OSS Tools NL',
      kind:    'project',
      members: [
        { webid: ANNE, displayName: 'Anne', role: 'admin' },
        { webid: BOB,  displayName: 'Bob',  role: 'member' },
      ],
      ...(storage ? { storage } : {}),
    },
    localStoreBundle: bundle,
  });
  return { crew, bundle };
}

describe('Tasks V2 — addTask embeds', () => {
  it('persists embeds on the stored task', async () => {
    const { crew } = await makeCrew();
    const r = await callSkill(crew.agent, 'addTask', {
      crewId: 'oss-tools',
      text:   'Paint the bench',
      embeds: [
        { type: 'supply-offer', ref: 'https://anne.pod/sharing/stoop/abc' },
        { type: 'note',         ref: 'pseudo-pod://abc/notes/123' },
      ],
    });
    expect(r.task.embeds).toEqual([
      { type: 'supply-offer', ref: 'https://anne.pod/sharing/stoop/abc' },
      { type: 'note',         ref: 'pseudo-pod://abc/notes/123' },
    ]);
  });

  it('omits embeds when none supplied (V1 back-compat)', async () => {
    const { crew } = await makeCrew();
    const r = await callSkill(crew.agent, 'addTask', {
      crewId: 'oss-tools',
      text:   'Plain task',
    });
    expect(r.task.embeds).toBeUndefined();
  });

  it('rejects entries missing type', async () => {
    const { crew } = await makeCrew();
    const r = await callSkill(crew.agent, 'addTask', {
      crewId: 'oss-tools',
      text:   'x',
      embeds: [{ ref: 'pseudo-pod://abc/x' }],
    });
    expect(r).toEqual({ error: 'embed-type-missing' });
  });

  it('rejects entries missing ref', async () => {
    const { crew } = await makeCrew();
    const r = await callSkill(crew.agent, 'addTask', {
      crewId: 'oss-tools',
      text:   'x',
      embeds: [{ type: 'task' }],
    });
    expect(r).toEqual({ error: 'embed-ref-missing' });
  });

  it('caps embeds at 8 per task', async () => {
    const { crew } = await makeCrew();
    const tooMany = Array.from({ length: 9 }, (_, i) => ({
      type: 'task',
      ref:  `pseudo-pod://abc/tasks/t-${i}`,
    }));
    const r = await callSkill(crew.agent, 'addTask', {
      crewId: 'oss-tools',
      text:   'x',
      embeds: tooMany,
    });
    expect(r?.error).toMatch(/embeds-too-many:9/);
  });
});

describe('Tasks V2 — crewConfig.storage', () => {
  it('defaults to no-pod when storage is omitted', async () => {
    const { crew } = await makeCrew();
    expect(crew.bundle?.crewState ?? crew.crewState ?? {}).toBeTruthy();
    const r = await callSkill(crew.agent, 'getCrewStoragePolicy', { crewId: 'oss-tools' });
    expect(r).toEqual({ policy: 'no-pod', groupPodUri: null });
  });

  it('honours centralised + groupPodUri from the config', async () => {
    const { crew } = await makeCrew({
      policy:      'centralised',
      groupPodUri: 'https://buurt.pod/',
    });
    const r = await callSkill(crew.agent, 'getCrewStoragePolicy', { crewId: 'oss-tools' });
    expect(r).toEqual({ policy: 'centralised', groupPodUri: 'https://buurt.pod/' });
  });

  it('forward-additive: unknown policies fall back to no-pod silently', async () => {
    const { crew } = await makeCrew({ policy: 'fancy-future-mode' });
    const r = await callSkill(crew.agent, 'getCrewStoragePolicy', { crewId: 'oss-tools' });
    expect(r.policy).toBe('no-pod');
  });
});

describe('Tasks V2 — setCrewStoragePolicy', () => {
  it('upgrades no-pod → centralised', async () => {
    const { crew } = await makeCrew();
    const r = await callSkill(crew.agent, 'setCrewStoragePolicy', {
      crewId:        'oss-tools',
      storagePolicy: 'centralised',
      groupPodUri:   'https://anne.pod/',
    });
    expect(r.storage).toEqual({ policy: 'centralised', groupPodUri: 'https://anne.pod/' });
    const after = await callSkill(crew.agent, 'getCrewStoragePolicy', { crewId: 'oss-tools' });
    expect(after.policy).toBe('centralised');
  });

  it('rejects downgrade to no-pod', async () => {
    const { crew } = await makeCrew({
      policy:      'centralised',
      groupPodUri: 'https://anne.pod/',
    });
    const r = await callSkill(crew.agent, 'setCrewStoragePolicy', {
      crewId:        'oss-tools',
      storagePolicy: 'no-pod',
    });
    expect(r?.error).toBe('storage-policy-downgrade-not-supported');
  });

  it('rejects non-admin', async () => {
    const { crew } = await makeCrew();
    const r = await callSkill(crew.agent, 'setCrewStoragePolicy', {
      crewId:        'oss-tools',
      storagePolicy: 'centralised',
      groupPodUri:   'https://anne.pod/',
    }, BOB);
    expect(r?.error).toBe('admin-only');
  });

  it('rejects centralised without groupPodUri', async () => {
    const { crew } = await makeCrew();
    const r = await callSkill(crew.agent, 'setCrewStoragePolicy', {
      crewId:        'oss-tools',
      storagePolicy: 'centralised',
    });
    expect(r?.error).toMatch(/storage-policy-needs-groupPodUri:centralised/);
  });
});

/**
 * V1.5 — custom-role management tests.
 *
 * Covers:
 *   1. listKnownRoles returns the standard 5 + crew customs.
 *   2. registerCrewCustomRole adds to liveCrew + the process registry.
 *   3. unregisterCrewCustomRole removes from both.
 *   4. Admin-only gate (member / coord rejected).
 *   5. Validation: empty id, missing rank, standard-role collision,
 *      duplicate-rank collision.
 *   6. Boot-time persistence: a CrewConfig with `customRoles` re-
 *      registers them on `createCrewAgent`.
 *   7. Round-trip — register → save crew config → recreate crew →
 *      role still registered (process-global persistence + boot
 *      reapply).
 *
 * The custom-role registry is process-global; tests use unique ids
 * (`v15-test-<rand>`) so multiple test files can share the process
 * without collisions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DataPart } from '@canopy/core';
import {
  isKnownRole, unregisterCustomRole,
} from '@canopy/core';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCrewAgent } from '../src/Crew.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CREW = {
  crewId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
};

async function callSkill(agent, skillId, args, fromWebid) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

function uniqueRoleId(label) {
  return `v15-test-${label}-${Math.random().toString(36).slice(2, 8)}`;
}

let lsBundle;
let crew;
const cleanupRoles = [];

beforeEach(async () => {
  lsBundle = buildBundle();
  crew = await createCrewAgent({
    crewConfig:           CREW,
    localStoreBundle:     lsBundle,
    wireOnboardingSkills: false,
  });
});

afterEach(async () => {
  for (const id of cleanupRoles) {
    try { unregisterCustomRole(id); } catch { /* noop */ }
  }
  cleanupRoles.length = 0;
  await crew?.close?.();
});

describe('V1.5 — listKnownRoles', () => {
  it('returns standard 5 roles when no customs registered', async () => {
    const r = await callSkill(crew.agent, 'listKnownRoles', {}, ANNE);
    const stdIds = r.roles.filter((x) => x.source === 'standard').map((x) => x.id).sort();
    expect(stdIds).toEqual(['admin', 'coordinator', 'external', 'member', 'observer']);
    expect(r.roles.find((x) => x.id === 'admin').rank).toBe(100);
    expect(r.roles.find((x) => x.id === 'external').rank).toBe(20);
  });
});

describe('V1.5 — registerCrewCustomRole', () => {
  it('admin can register a new role; appears in listKnownRoles + crew config + process registry', async () => {
    const id = uniqueRoleId('plumber');
    cleanupRoles.push(id);

    const r = await callSkill(crew.agent, 'registerCrewCustomRole',
      { roleId: id, rank: 50 }, ANNE);
    expect(r.ok).toBe(true);
    expect(r.role).toEqual({ id, rank: 50 });

    const list = await callSkill(crew.agent, 'listKnownRoles', {}, ANNE);
    const found = list.roles.find((x) => x.id === id);
    expect(found).toBeTruthy();
    expect(found.source).toBe('crew');
    expect(found.rank).toBe(50);

    // Process registry knows about it too.
    expect(isKnownRole(id)).toBe(true);

    // Crew config persisted.
    const cfg = await callSkill(crew.agent, 'getCrewConfig');
    expect(cfg.crew.customRoles.find((x) => x.id === id)).toBeTruthy();
  });

  it('coordinator cannot register (admin-only)', async () => {
    const id = uniqueRoleId('blocked');
    const r = await callSkill(crew.agent, 'registerCrewCustomRole',
      { roleId: id, rank: 50 }, FRITS);
    expect(r.error).toMatch(/admin/i);
    expect(isKnownRole(id)).toBe(false);
  });

  it('member cannot register', async () => {
    const id = uniqueRoleId('blocked2');
    const r = await callSkill(crew.agent, 'registerCrewCustomRole',
      { roleId: id, rank: 50 }, KID);
    expect(r.error).toMatch(/admin/i);
  });

  it('rejects empty roleId / non-numeric rank / standard-role collision', async () => {
    expect((await callSkill(crew.agent, 'registerCrewCustomRole',
      { roleId: '', rank: 50 }, ANNE)).error).toMatch(/roleId/);
    expect((await callSkill(crew.agent, 'registerCrewCustomRole',
      { roleId: 'x', rank: 'banana' }, ANNE)).error).toMatch(/rank/);
    expect((await callSkill(crew.agent, 'registerCrewCustomRole',
      { roleId: 'admin', rank: 50 }, ANNE)).error).toMatch(/standard/);
  });

  it('rejects duplicate rank from another custom role', async () => {
    const id1 = uniqueRoleId('first');
    const id2 = uniqueRoleId('second');
    cleanupRoles.push(id1, id2);

    const a = await callSkill(crew.agent, 'registerCrewCustomRole',
      { roleId: id1, rank: 55 }, ANNE);
    expect(a.ok).toBe(true);

    const b = await callSkill(crew.agent, 'registerCrewCustomRole',
      { roleId: id2, rank: 55 }, ANNE);
    expect(b.error).toMatch(/rank/);
  });
});

describe('V1.5 — unregisterCrewCustomRole', () => {
  it('admin removes a registered custom role', async () => {
    const id = uniqueRoleId('temp');
    cleanupRoles.push(id);

    await callSkill(crew.agent, 'registerCrewCustomRole', { roleId: id, rank: 45 }, ANNE);
    expect(isKnownRole(id)).toBe(true);

    const r = await callSkill(crew.agent, 'unregisterCrewCustomRole', { roleId: id }, ANNE);
    expect(r.ok).toBe(true);
    expect(isKnownRole(id)).toBe(false);

    const cfg = await callSkill(crew.agent, 'getCrewConfig');
    expect(cfg.crew.customRoles.find((x) => x.id === id)).toBeFalsy();
  });

  it('rejects unregistering a standard role', async () => {
    const r = await callSkill(crew.agent, 'unregisterCrewCustomRole',
      { roleId: 'admin' }, ANNE);
    expect(r.error).toMatch(/standard/i);
  });

  it('non-admin cannot unregister', async () => {
    const id = uniqueRoleId('locked');
    cleanupRoles.push(id);
    await callSkill(crew.agent, 'registerCrewCustomRole', { roleId: id, rank: 35 }, ANNE);
    const r = await callSkill(crew.agent, 'unregisterCrewCustomRole',
      { roleId: id }, FRITS);
    expect(r.error).toMatch(/admin/i);
    expect(isKnownRole(id)).toBe(true);
  });
});

describe('V1.5 — boot-time custom-role re-registration', () => {
  it('a CrewConfig with customRoles re-registers them on createCrewAgent', async () => {
    const id = uniqueRoleId('boot');
    cleanupRoles.push(id);

    // Make sure the role is NOT already in the registry, then create
    // a new crew with customRoles and verify the boot-time call
    // registers it.
    expect(isKnownRole(id)).toBe(false);

    const lsBundle2 = buildBundle();
    const crew2 = await createCrewAgent({
      crewConfig: {
        ...CREW,
        crewId: 'oss-tools-boot',
        customRoles: [{ id, rank: 38 }],
      },
      localStoreBundle:     lsBundle2,
      wireOnboardingSkills: false,
    });

    expect(isKnownRole(id)).toBe(true);

    await crew2.close?.();
  });

  it('listKnownRoles surfaces customs from both the crew + the process registry', async () => {
    const idCrew    = uniqueRoleId('in-crew');
    const idProcess = uniqueRoleId('in-process');
    cleanupRoles.push(idCrew, idProcess);

    // Register one via the skill (lands in the crew config).
    await callSkill(crew.agent, 'registerCrewCustomRole',
      { roleId: idCrew, rank: 33 }, ANNE);

    // Register another directly into the process registry, NOT via
    // this crew (simulates a different crew's earlier registration
    // that this crew didn't know about).
    const { registerCustomRole } = await import('@canopy/core');
    registerCustomRole(idProcess, 22);

    const r = await callSkill(crew.agent, 'listKnownRoles', {}, ANNE);
    const ids = r.roles.map((x) => x.id);
    expect(ids).toContain(idCrew);
    expect(ids).toContain(idProcess);

    const fromCrew    = r.roles.find((x) => x.id === idCrew);
    const fromProcess = r.roles.find((x) => x.id === idProcess);
    expect(fromCrew.source).toBe('crew');
    expect(fromProcess.source).toBe('process');
  });
});

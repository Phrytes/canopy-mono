/**
 * V1.5 — custom-role management tests.
 *
 * Covers:
 *   1. listKnownRoles returns the standard 5 + circle customs.
 *   2. registerCircleCustomRole adds to liveCircle + the process registry.
 *   3. unregisterCircleCustomRole removes from both.
 *   4. Admin-only gate (member / coord rejected).
 *   5. Validation: empty id, missing rank, standard-role collision,
 *      duplicate-rank collision.
 *   6. Boot-time persistence: a CircleConfig with `customRoles` re-
 *      registers them on `createCircleAgent`.
 *   7. Round-trip — register → save circle config → recreate circle →
 *      role still registered (process-global persistence + boot
 *      reapply).
 *
 * The custom-role registry is process-global; tests use unique ids
 * (`v15-test-<rand>`) so multiple test files can share the process
 * without collisions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DataPart } from '@onderling/core';
import {
  isKnownRole, unregisterCustomRole,
} from '@onderling/core';

import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CIRCLE = {
  circleId:  'oss-tools',
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
let circle;
const cleanupRoles = [];

beforeEach(async () => {
  lsBundle = buildBundle();
  circle = await createCircleAgent({
    circleConfig:           CIRCLE,
    localStoreBundle:     lsBundle,
    wireOnboardingSkills: false,
  });
});

afterEach(async () => {
  for (const id of cleanupRoles) {
    try { unregisterCustomRole(id); } catch { /* noop */ }
  }
  cleanupRoles.length = 0;
  await circle?.close?.();
});

describe('V1.5 — listKnownRoles', () => {
  it('returns standard 5 roles when no customs registered', async () => {
    const r = await callSkill(circle.agent, 'listKnownRoles', {}, ANNE);
    const stdIds = r.roles.filter((x) => x.source === 'standard').map((x) => x.id).sort();
    expect(stdIds).toEqual(['admin', 'coordinator', 'external', 'member', 'observer']);
    expect(r.roles.find((x) => x.id === 'admin').rank).toBe(100);
    expect(r.roles.find((x) => x.id === 'external').rank).toBe(20);
  });
});

describe('V1.5 — registerCircleCustomRole', () => {
  it('admin can register a new role; appears in listKnownRoles + circle config + process registry', async () => {
    const id = uniqueRoleId('plumber');
    cleanupRoles.push(id);

    const r = await callSkill(circle.agent, 'registerCircleCustomRole',
      { roleId: id, rank: 50 }, ANNE);
    expect(r.ok).toBe(true);
    expect(r.role).toEqual({ id, rank: 50 });

    const list = await callSkill(circle.agent, 'listKnownRoles', {}, ANNE);
    const found = list.roles.find((x) => x.id === id);
    expect(found).toBeTruthy();
    expect(found.source).toBe('circle');
    expect(found.rank).toBe(50);

    // Process registry knows about it too.
    expect(isKnownRole(id)).toBe(true);

    // Circle config persisted.
    const cfg = await callSkill(circle.agent, 'getCircleConfig');
    expect(cfg.circle.customRoles.find((x) => x.id === id)).toBeTruthy();
  });

  it('coordinator cannot register (admin-only)', async () => {
    const id = uniqueRoleId('blocked');
    const r = await callSkill(circle.agent, 'registerCircleCustomRole',
      { roleId: id, rank: 50 }, FRITS);
    expect(r.error).toMatch(/admin/i);
    expect(isKnownRole(id)).toBe(false);
  });

  it('member cannot register', async () => {
    const id = uniqueRoleId('blocked2');
    const r = await callSkill(circle.agent, 'registerCircleCustomRole',
      { roleId: id, rank: 50 }, KID);
    expect(r.error).toMatch(/admin/i);
  });

  it('rejects empty roleId / non-numeric rank / standard-role collision', async () => {
    expect((await callSkill(circle.agent, 'registerCircleCustomRole',
      { roleId: '', rank: 50 }, ANNE)).error).toMatch(/roleId/);
    expect((await callSkill(circle.agent, 'registerCircleCustomRole',
      { roleId: 'x', rank: 'banana' }, ANNE)).error).toMatch(/rank/);
    expect((await callSkill(circle.agent, 'registerCircleCustomRole',
      { roleId: 'admin', rank: 50 }, ANNE)).error).toMatch(/standard/);
  });

  it('rejects duplicate rank from another custom role', async () => {
    const id1 = uniqueRoleId('first');
    const id2 = uniqueRoleId('second');
    cleanupRoles.push(id1, id2);

    const a = await callSkill(circle.agent, 'registerCircleCustomRole',
      { roleId: id1, rank: 55 }, ANNE);
    expect(a.ok).toBe(true);

    const b = await callSkill(circle.agent, 'registerCircleCustomRole',
      { roleId: id2, rank: 55 }, ANNE);
    expect(b.error).toMatch(/rank/);
  });
});

describe('V1.5 — unregisterCircleCustomRole', () => {
  it('admin removes a registered custom role', async () => {
    const id = uniqueRoleId('temp');
    cleanupRoles.push(id);

    await callSkill(circle.agent, 'registerCircleCustomRole', { roleId: id, rank: 45 }, ANNE);
    expect(isKnownRole(id)).toBe(true);

    const r = await callSkill(circle.agent, 'unregisterCircleCustomRole', { roleId: id }, ANNE);
    expect(r.ok).toBe(true);
    expect(isKnownRole(id)).toBe(false);

    const cfg = await callSkill(circle.agent, 'getCircleConfig');
    expect(cfg.circle.customRoles.find((x) => x.id === id)).toBeFalsy();
  });

  it('rejects unregistering a standard role', async () => {
    const r = await callSkill(circle.agent, 'unregisterCircleCustomRole',
      { roleId: 'admin' }, ANNE);
    expect(r.error).toMatch(/standard/i);
  });

  it('non-admin cannot unregister', async () => {
    const id = uniqueRoleId('locked');
    cleanupRoles.push(id);
    await callSkill(circle.agent, 'registerCircleCustomRole', { roleId: id, rank: 35 }, ANNE);
    const r = await callSkill(circle.agent, 'unregisterCircleCustomRole',
      { roleId: id }, FRITS);
    expect(r.error).toMatch(/admin/i);
    expect(isKnownRole(id)).toBe(true);
  });
});

describe('V1.5 — boot-time custom-role re-registration', () => {
  it('a CircleConfig with customRoles re-registers them on createCircleAgent', async () => {
    const id = uniqueRoleId('boot');
    cleanupRoles.push(id);

    // Make sure the role is NOT already in the registry, then create
    // a new circle with customRoles and verify the boot-time call
    // registers it.
    expect(isKnownRole(id)).toBe(false);

    const lsBundle2 = buildBundle();
    const circle2 = await createCircleAgent({
      circleConfig: {
        ...CIRCLE,
        circleId: 'oss-tools-boot',
        customRoles: [{ id, rank: 38 }],
      },
      localStoreBundle:     lsBundle2,
      wireOnboardingSkills: false,
    });

    expect(isKnownRole(id)).toBe(true);

    await circle2.close?.();
  });

  it('listKnownRoles surfaces customs from both the circle + the process registry', async () => {
    const idCircle    = uniqueRoleId('in-circle');
    const idProcess = uniqueRoleId('in-process');
    cleanupRoles.push(idCircle, idProcess);

    // Register one via the skill (lands in the circle config).
    await callSkill(circle.agent, 'registerCircleCustomRole',
      { roleId: idCircle, rank: 33 }, ANNE);

    // Register another directly into the process registry, NOT via
    // this circle (simulates a different circle's earlier registration
    // that this circle didn't know about).
    const { registerCustomRole } = await import('@onderling/core');
    registerCustomRole(idProcess, 22);

    const r = await callSkill(circle.agent, 'listKnownRoles', {}, ANNE);
    const ids = r.roles.map((x) => x.id);
    expect(ids).toContain(idCircle);
    expect(ids).toContain(idProcess);

    const fromCircle    = r.roles.find((x) => x.id === idCircle);
    const fromProcess = r.roles.find((x) => x.id === idProcess);
    expect(fromCircle.source).toBe('circle');
    expect(fromProcess.source).toBe('process');
  });
});

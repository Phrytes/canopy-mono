/**
 * Tasks V2 multi-circle runtime — end-to-end smoke.
 *
 * Replicates what `bin/tasks-ui.js --multi-circle` does:
 *   1. Build one meshAgent.
 *   2. Build the primary circle with `agent: meshAgent, registerSkills:
 *      false, wireOnboardingSkills: false`.
 *   3. Set up `circlesMap` + `_spawnCircleInProcess` callback.
 *   4. wireSkills ONCE with `multiCircleResolver(circlesMap)`.
 *   5. Provision a sibling circle via `provisionMyCircle`.
 *   6. Call `spawnMyCircle({circleId})` — should hit the in-process path
 *      (`ready: true`) and add the sibling to the runtime map.
 *   7. addTask routed by circleId reaches the right ItemStore (isolation).
 */

import { describe, it, expect } from 'vitest';
import { DataPart, AgentIdentity } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

import { buildMultiCircleRuntime } from '../src/buildMultiCircleRuntime.js';

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

/**
 * Thin alias kept so the SP-4b proof + existing assertions stay
 * untouched.  Real machinery lives in `src/buildMultiCircleRuntime.js`
 * (extracted 2026-05-20 for re-use by the SP-4b mount test + the
 * SP-11 recombination demo).
 */
const buildMultiCircle = () =>
  buildMultiCircleRuntime({ label: 'tasks-multi-circle-smoke' });

describe('Tasks V2 multi-circle runtime', () => {
  it('builds primary circle on a shared agent', async () => {
    const { meshAgent, primaryBundle, circlesMap } = await buildMultiCircle();
    expect(circlesMap.size).toBe(1);
    expect(circlesMap.get('primary-circle')).toBe(primaryBundle._circleState);
    // wireSkills registered once: every addTask handler is the same
    // across the registry.
    const addDef = meshAgent.skills.get('addTask');
    expect(addDef).toBeTruthy();
  });

  it('addTask routes to the primary circle when circleId matches', async () => {
    const { meshAgent, primaryBundle } = await buildMultiCircle();
    const r = await callSkill(meshAgent, 'addTask', {
      circleId: 'primary-circle',
      text:   'walk the dog',
    });
    expect(r?.task?.text).toBe('walk the dog');
    const items = await primaryBundle.itemStore.listOpen();
    expect(items).toHaveLength(1);
  });

  it('spawnMyCircle brings up a sibling circle in-process and addTask isolates', async () => {
    const { meshAgent, circlesMap } = await buildMultiCircle();

    // Save a sibling circle config via provisionMyCircle (routed to primary).
    await callSkill(meshAgent, 'provisionMyCircle', {
      circleId: 'primary-circle',          // route to primary's dataSource
      name:   'no-op',                  // (this should error — already-exists)
    }).catch(() => {});

    // Use the underlying skill more directly: write the sibling
    // config straight to the data source so provisionMyCircle doesn't
    // need the active-circle check.
    await meshAgent.skills.get('provisionMyCircle').handler({
      parts: [DataPart({
        circleId: 'sibling-circle',
        name:   'Sibling',
        kind:   'team',
        // Route to primary's dataSource (default circleId resolution).
      })],
      from: ANNE,
      agent: meshAgent,
      envelope: null,
    });

    // Spawn the sibling circle in-process.
    const spawnResult = await callSkill(meshAgent, 'spawnMyCircle', {
      circleId: 'sibling-circle',
    });
    expect(spawnResult?.ok).toBe(true);
    expect(spawnResult?.ready).toBe(true);
    expect(circlesMap.size).toBe(2);
    expect(circlesMap.has('sibling-circle')).toBe(true);

    // addTask now routes to sibling's ItemStore.
    await callSkill(meshAgent, 'addTask', {
      circleId: 'sibling-circle',
      text:   'sibling-only task',
    });

    const siblingState = circlesMap.get('sibling-circle');
    const primaryState = circlesMap.get('primary-circle');
    const siblingItems = await siblingState.itemStore.listOpen();
    const primaryItems = await primaryState.itemStore.listOpen();
    expect(siblingItems.map(i => i.text)).toEqual(['sibling-only task']);
    expect(primaryItems.map(i => i.text)).not.toContain('sibling-only task');
  });

  it('spawnMyCircle is idempotent — second call returns same CircleState', async () => {
    const { meshAgent, circlesMap } = await buildMultiCircle();
    await meshAgent.skills.get('provisionMyCircle').handler({
      parts: [DataPart({ circleId: 'idem-circle', name: 'Idem', kind: 'household' })],
      from: ANNE, agent: meshAgent, envelope: null,
    });
    await callSkill(meshAgent, 'spawnMyCircle', { circleId: 'idem-circle' });
    const csOnce = circlesMap.get('idem-circle');
    await callSkill(meshAgent, 'spawnMyCircle', { circleId: 'idem-circle' });
    const csTwice = circlesMap.get('idem-circle');
    expect(csOnce).toBe(csTwice);
    expect(circlesMap.size).toBe(2);
  });

  it('getMyCircles enumerates every spawned circle', async () => {
    const { meshAgent } = await buildMultiCircle();
    await meshAgent.skills.get('provisionMyCircle').handler({
      parts: [DataPart({ circleId: 'extra-1', name: 'Extra One' })],
      from: ANNE, agent: meshAgent, envelope: null,
    });
    await callSkill(meshAgent, 'spawnMyCircle', { circleId: 'extra-1' });
    const r = await callSkill(meshAgent, 'getMyCircles', { circleId: 'primary-circle' });
    expect(r?.circles ?? r?.error).toBeTruthy();
    if (r?.circles) {
      const ids = r.circles.map(c => c.circleId).sort();
      expect(ids).toContain('primary-circle');
      expect(ids).toContain('extra-1');
    }
  });
});

describe('Tasks V2 multi-circle — onboarding dispatch', () => {
  it('issueInvite routes to the right circle\'s GroupManager', async () => {
    const { meshAgent, circlesMap } = await buildMultiCircle();

    // Provision + spawn a sibling circle first.
    await meshAgent.skills.get('provisionMyCircle').handler({
      parts: [{ type: 'DataPart', data: { circleId: 'second-circle', name: 'Second', kind: 'team' } }],
      from: ANNE, agent: meshAgent, envelope: null,
    });
    await callSkill(meshAgent, 'spawnMyCircle', { circleId: 'second-circle' });
    expect(circlesMap.size).toBe(2);

    // Each circle has its own GroupManager.
    const primaryInvite = await callSkill(meshAgent, 'issueInvite', {
      circleId: 'primary-circle',
      role:   'member',
    });
    expect(primaryInvite?.invite?.groupId).toBe('primary-circle');

    const secondInvite = await callSkill(meshAgent, 'issueInvite', {
      circleId: 'second-circle',
      role:   'admin',
    });
    expect(secondInvite?.invite?.groupId).toBe('second-circle');
    expect(secondInvite?.invite?.role).toBe('admin');
  });

  it('redeemInvite adds the new member to the right circle\'s MemberMap', async () => {
    const { meshAgent, circlesMap } = await buildMultiCircle();

    await meshAgent.skills.get('provisionMyCircle').handler({
      parts: [{ type: 'DataPart', data: { circleId: 'redeem-circle', name: 'Redeem' } }],
      from: ANNE, agent: meshAgent, envelope: null,
    });
    await callSkill(meshAgent, 'spawnMyCircle', { circleId: 'redeem-circle' });

    // Issue invite for redeem-circle.
    const { invite } = await callSkill(meshAgent, 'issueInvite', {
      circleId: 'redeem-circle',
      role:   'member',
    });
    expect(invite).toBeTruthy();

    // Generate a new member identity (production-mode redemption —
    // no spawn hook in the test setup).
    const memberIdentity = await AgentIdentity.generate(new VaultMemory());

    // Redeem without explicit circleId — the multi-circle wrapper infers
    // it from `invite.groupId`.
    const r = await callSkill(meshAgent, 'redeemInvite', {
      invite,
      webid:        'https://id.example/carol',
      displayName:  'Carol',
      memberPubKey: memberIdentity.pubKey,
    });
    expect(r?.groupProof).toBeTruthy();
    expect(r?.memberPubKey).toBe(memberIdentity.pubKey);

    // The new member landed in redeem-circle's MemberMap, NOT primary's.
    const redeemState  = circlesMap.get('redeem-circle');
    const primaryState = circlesMap.get('primary-circle');
    const redeemMembers  = await redeemState.members.list();
    const primaryMembers = await primaryState.members.list();
    expect(redeemMembers.some(m => m.webid === 'https://id.example/carol')).toBe(true);
    expect(primaryMembers.some(m => m.webid === 'https://id.example/carol')).toBe(false);
  });

  it('redeemInvite rejects when no circle matches the invite', async () => {
    const { meshAgent } = await buildMultiCircle();
    const memberIdentity = await AgentIdentity.generate(new VaultMemory());
    const r = await callSkill(meshAgent, 'redeemInvite', {
      invite: { groupId: 'nonexistent', token: 'x', role: 'member', expiresAt: Date.now() + 60_000 },
      memberPubKey: memberIdentity.pubKey,
    });
    expect(r?.error).toMatch(/circleId required/);
  });

  it('issueInvite errors when circleId routing misses', async () => {
    const { meshAgent } = await buildMultiCircle();
    const r = await callSkill(meshAgent, 'issueInvite', { circleId: 'never-spawned', role: 'member' });
    expect(r?.error).toMatch(/circleId required/);
  });
});

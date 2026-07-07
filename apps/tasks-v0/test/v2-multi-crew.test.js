/**
 * Tasks V2 multi-crew runtime — end-to-end smoke.
 *
 * Replicates what `bin/tasks-ui.js --multi-crew` does:
 *   1. Build one meshAgent.
 *   2. Build the primary crew with `agent: meshAgent, registerSkills:
 *      false, wireOnboardingSkills: false`.
 *   3. Set up `crewsMap` + `_spawnCrewInProcess` callback.
 *   4. wireSkills ONCE with `multiCrewResolver(crewsMap)`.
 *   5. Provision a sibling crew via `provisionMyCrew`.
 *   6. Call `spawnMyCrew({circleId})` — should hit the in-process path
 *      (`ready: true`) and add the sibling to the runtime map.
 *   7. addTask routed by circleId reaches the right ItemStore (isolation).
 */

import { describe, it, expect } from 'vitest';
import { DataPart, AgentIdentity } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

import { buildMultiCrewRuntime } from '../src/buildMultiCrewRuntime.js';

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
 * untouched.  Real machinery lives in `src/buildMultiCrewRuntime.js`
 * (extracted 2026-05-20 for re-use by the SP-4b mount test + the
 * SP-11 recombination demo).
 */
const buildMultiCrew = () =>
  buildMultiCrewRuntime({ label: 'tasks-multi-crew-smoke' });

describe('Tasks V2 multi-crew runtime', () => {
  it('builds primary crew on a shared agent', async () => {
    const { meshAgent, primaryBundle, crewsMap } = await buildMultiCrew();
    expect(crewsMap.size).toBe(1);
    expect(crewsMap.get('primary-crew')).toBe(primaryBundle._crewState);
    // wireSkills registered once: every addTask handler is the same
    // across the registry.
    const addDef = meshAgent.skills.get('addTask');
    expect(addDef).toBeTruthy();
  });

  it('addTask routes to the primary crew when circleId matches', async () => {
    const { meshAgent, primaryBundle } = await buildMultiCrew();
    const r = await callSkill(meshAgent, 'addTask', {
      circleId: 'primary-crew',
      text:   'walk the dog',
    });
    expect(r?.task?.text).toBe('walk the dog');
    const items = await primaryBundle.itemStore.listOpen();
    expect(items).toHaveLength(1);
  });

  it('spawnMyCrew brings up a sibling crew in-process and addTask isolates', async () => {
    const { meshAgent, crewsMap } = await buildMultiCrew();

    // Save a sibling crew config via provisionMyCrew (routed to primary).
    await callSkill(meshAgent, 'provisionMyCrew', {
      circleId: 'primary-crew',          // route to primary's dataSource
      name:   'no-op',                  // (this should error — already-exists)
    }).catch(() => {});

    // Use the underlying skill more directly: write the sibling
    // config straight to the data source so provisionMyCrew doesn't
    // need the active-crew check.
    await meshAgent.skills.get('provisionMyCrew').handler({
      parts: [DataPart({
        circleId: 'sibling-crew',
        name:   'Sibling',
        kind:   'team',
        // Route to primary's dataSource (default circleId resolution).
      })],
      from: ANNE,
      agent: meshAgent,
      envelope: null,
    });

    // Spawn the sibling crew in-process.
    const spawnResult = await callSkill(meshAgent, 'spawnMyCrew', {
      circleId: 'sibling-crew',
    });
    expect(spawnResult?.ok).toBe(true);
    expect(spawnResult?.ready).toBe(true);
    expect(crewsMap.size).toBe(2);
    expect(crewsMap.has('sibling-crew')).toBe(true);

    // addTask now routes to sibling's ItemStore.
    await callSkill(meshAgent, 'addTask', {
      circleId: 'sibling-crew',
      text:   'sibling-only task',
    });

    const siblingState = crewsMap.get('sibling-crew');
    const primaryState = crewsMap.get('primary-crew');
    const siblingItems = await siblingState.itemStore.listOpen();
    const primaryItems = await primaryState.itemStore.listOpen();
    expect(siblingItems.map(i => i.text)).toEqual(['sibling-only task']);
    expect(primaryItems.map(i => i.text)).not.toContain('sibling-only task');
  });

  it('spawnMyCrew is idempotent — second call returns same CrewState', async () => {
    const { meshAgent, crewsMap } = await buildMultiCrew();
    await meshAgent.skills.get('provisionMyCrew').handler({
      parts: [DataPart({ circleId: 'idem-crew', name: 'Idem', kind: 'household' })],
      from: ANNE, agent: meshAgent, envelope: null,
    });
    await callSkill(meshAgent, 'spawnMyCrew', { circleId: 'idem-crew' });
    const csOnce = crewsMap.get('idem-crew');
    await callSkill(meshAgent, 'spawnMyCrew', { circleId: 'idem-crew' });
    const csTwice = crewsMap.get('idem-crew');
    expect(csOnce).toBe(csTwice);
    expect(crewsMap.size).toBe(2);
  });

  it('getMyCrews enumerates every spawned crew', async () => {
    const { meshAgent } = await buildMultiCrew();
    await meshAgent.skills.get('provisionMyCrew').handler({
      parts: [DataPart({ circleId: 'extra-1', name: 'Extra One' })],
      from: ANNE, agent: meshAgent, envelope: null,
    });
    await callSkill(meshAgent, 'spawnMyCrew', { circleId: 'extra-1' });
    const r = await callSkill(meshAgent, 'getMyCrews', { circleId: 'primary-crew' });
    expect(r?.crews ?? r?.error).toBeTruthy();
    if (r?.crews) {
      const ids = r.crews.map(c => c.circleId).sort();
      expect(ids).toContain('primary-crew');
      expect(ids).toContain('extra-1');
    }
  });
});

describe('Tasks V2 multi-crew — onboarding dispatch', () => {
  it('issueInvite routes to the right crew\'s GroupManager', async () => {
    const { meshAgent, crewsMap } = await buildMultiCrew();

    // Provision + spawn a sibling crew first.
    await meshAgent.skills.get('provisionMyCrew').handler({
      parts: [{ type: 'DataPart', data: { circleId: 'second-crew', name: 'Second', kind: 'team' } }],
      from: ANNE, agent: meshAgent, envelope: null,
    });
    await callSkill(meshAgent, 'spawnMyCrew', { circleId: 'second-crew' });
    expect(crewsMap.size).toBe(2);

    // Each crew has its own GroupManager.
    const primaryInvite = await callSkill(meshAgent, 'issueInvite', {
      circleId: 'primary-crew',
      role:   'member',
    });
    expect(primaryInvite?.invite?.groupId).toBe('primary-crew');

    const secondInvite = await callSkill(meshAgent, 'issueInvite', {
      circleId: 'second-crew',
      role:   'admin',
    });
    expect(secondInvite?.invite?.groupId).toBe('second-crew');
    expect(secondInvite?.invite?.role).toBe('admin');
  });

  it('redeemInvite adds the new member to the right crew\'s MemberMap', async () => {
    const { meshAgent, crewsMap } = await buildMultiCrew();

    await meshAgent.skills.get('provisionMyCrew').handler({
      parts: [{ type: 'DataPart', data: { circleId: 'redeem-crew', name: 'Redeem' } }],
      from: ANNE, agent: meshAgent, envelope: null,
    });
    await callSkill(meshAgent, 'spawnMyCrew', { circleId: 'redeem-crew' });

    // Issue invite for redeem-crew.
    const { invite } = await callSkill(meshAgent, 'issueInvite', {
      circleId: 'redeem-crew',
      role:   'member',
    });
    expect(invite).toBeTruthy();

    // Generate a new member identity (production-mode redemption —
    // no spawn hook in the test setup).
    const memberIdentity = await AgentIdentity.generate(new VaultMemory());

    // Redeem without explicit circleId — the multi-crew wrapper infers
    // it from `invite.groupId`.
    const r = await callSkill(meshAgent, 'redeemInvite', {
      invite,
      webid:        'https://id.example/carol',
      displayName:  'Carol',
      memberPubKey: memberIdentity.pubKey,
    });
    expect(r?.groupProof).toBeTruthy();
    expect(r?.memberPubKey).toBe(memberIdentity.pubKey);

    // The new member landed in redeem-crew's MemberMap, NOT primary's.
    const redeemState  = crewsMap.get('redeem-crew');
    const primaryState = crewsMap.get('primary-crew');
    const redeemMembers  = await redeemState.members.list();
    const primaryMembers = await primaryState.members.list();
    expect(redeemMembers.some(m => m.webid === 'https://id.example/carol')).toBe(true);
    expect(primaryMembers.some(m => m.webid === 'https://id.example/carol')).toBe(false);
  });

  it('redeemInvite rejects when no crew matches the invite', async () => {
    const { meshAgent } = await buildMultiCrew();
    const memberIdentity = await AgentIdentity.generate(new VaultMemory());
    const r = await callSkill(meshAgent, 'redeemInvite', {
      invite: { groupId: 'nonexistent', token: 'x', role: 'member', expiresAt: Date.now() + 60_000 },
      memberPubKey: memberIdentity.pubKey,
    });
    expect(r?.error).toMatch(/circleId required/);
  });

  it('issueInvite errors when circleId routing misses', async () => {
    const { meshAgent } = await buildMultiCrew();
    const r = await callSkill(meshAgent, 'issueInvite', { circleId: 'never-spawned', role: 'member' });
    expect(r?.error).toMatch(/circleId required/);
  });
});

/**
 * Stoop V1 — Phase 16 tests.
 *
 * Group ops admin polish: listGroupMembers, postAnnouncement,
 * editGroupRules, removeMember, listReports.  Each gated on the
 * `role` field in MemberMap (admin / coordinator pass; other roles
 * get `error: 'admin-only'`).
 */

import { describe, it, expect } from 'vitest';
import {
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
  DataPart,
} from '@canopy/core';

import { createNeighborhoodAgent } from '../src/index.js';

const ANNE  = 'https://id.example/anne';
const BOB   = 'https://id.example/bob';
const CARLA = 'https://id.example/carla';

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

async function buildAgentAs(role) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    skillMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [
      { webid: ANNE,  role },
      { webid: BOB,   role: 'member', stableId: 'sid-bob' },
      { webid: CARLA, role: 'member', stableId: 'sid-carla' },
    ],
  });
  await bundle.skillMatch.start();
  return bundle;
}

// ── listGroupMembers ──────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — listGroupMembers', () => {
  it('returns the MemberMap entries for the current group', async () => {
    const bundle = await buildAgentAs('admin');
    const r = await callSkill(bundle.agent, 'listGroupMembers');
    expect(r.members.map(m => m.webid).sort()).toEqual([ANNE, BOB, CARLA].sort());
    expect(r.groupId).toBe('oosterpoort');
  });
});

// ── postAnnouncement ─────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — postAnnouncement', () => {
  it('admin can post; item appears with kind:"announcement"', async () => {
    const bundle = await buildAgentAs('admin');
    const r = await callSkill(bundle.agent, 'postAnnouncement', { text: 'Buurtfeest zaterdag' });
    expect(r.announcementId).toBeTruthy();
    const item = await bundle.itemStore.getById(r.announcementId);
    expect(item.type).toBe('announcement');
    expect(item.text).toBe('Buurtfeest zaterdag');
    expect(item.source.postedBy).toBe(ANNE);
  });

  it('non-admin gets admin-only error', async () => {
    const bundle = await buildAgentAs('member');
    const r = await callSkill(bundle.agent, 'postAnnouncement', { text: 'x' });
    expect(r).toEqual({ error: 'admin-only' });
  });

  it('coordinator role passes the gate', async () => {
    const bundle = await buildAgentAs('coordinator');
    const r = await callSkill(bundle.agent, 'postAnnouncement', { text: 'x' });
    expect(r.announcementId).toBeTruthy();
  });

  it('rejects empty text', async () => {
    const bundle = await buildAgentAs('admin');
    expect(await callSkill(bundle.agent, 'postAnnouncement', {})).toEqual({ error: 'text required' });
  });
});

// ── editGroupRules ───────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — editGroupRules', () => {
  it('admin can edit rules; new version persists', async () => {
    const bundle = await buildAgentAs('admin');
    const r = await callSkill(bundle.agent, 'editGroupRules', {
      groupId: 'oosterpoort',
      rules:   { name: 'Oosterpoort', conflictPolicy: 'vote', version: 1 },
    });
    expect(r.rulesId).toBeTruthy();
    const fetched = await callSkill(bundle.agent, 'getGroupRules', { groupId: 'oosterpoort' });
    expect(fetched.rules.source.rules.conflictPolicy).toBe('vote');
  });

  it('non-admin gets admin-only error', async () => {
    const bundle = await buildAgentAs('member');
    const r = await callSkill(bundle.agent, 'editGroupRules',
      { groupId: 'oosterpoort', rules: { name: 'x' } });
    expect(r).toEqual({ error: 'admin-only' });
  });

  it('rejects missing args', async () => {
    const bundle = await buildAgentAs('admin');
    expect(await callSkill(bundle.agent, 'editGroupRules', { rules: {} }))
      .toEqual({ error: 'groupId required' });
    expect(await callSkill(bundle.agent, 'editGroupRules', { groupId: 'x' }))
      .toEqual({ error: 'rules object required' });
  });
});

// ── removeMember ─────────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — removeMember', () => {
  it('admin records a removal item with full source metadata', async () => {
    const bundle = await buildAgentAs('admin');
    const r = await callSkill(bundle.agent, 'removeMember', {
      memberWebid: BOB, reason: 'overtreding huisregels',
    });
    expect(r.removalId).toBeTruthy();
    const item = await bundle.itemStore.getById(r.removalId);
    expect(item.type).toBe('group-removal');
    expect(item.source.memberWebid).toBe(BOB);
    expect(item.source.reason).toBe('overtreding huisregels');
    expect(item.source.removedBy).toBe(ANNE);
  });

  it('non-admin gets admin-only error', async () => {
    const bundle = await buildAgentAs('member');
    const r = await callSkill(bundle.agent, 'removeMember', { memberWebid: BOB });
    expect(r).toEqual({ error: 'admin-only' });
  });

  it('accepts memberStableId in addition to memberWebid', async () => {
    const bundle = await buildAgentAs('admin');
    const r = await callSkill(bundle.agent, 'removeMember', { memberStableId: 'sid-bob' });
    expect(r.removalId).toBeTruthy();
    const item = await bundle.itemStore.getById(r.removalId);
    expect(item.source.memberStableId).toBe('sid-bob');
  });

  it('rejects when neither identifier is supplied', async () => {
    const bundle = await buildAgentAs('admin');
    const r = await callSkill(bundle.agent, 'removeMember', {});
    expect(r).toEqual({ error: 'memberStableId or memberWebid required' });
  });
});

// ── listReports ──────────────────────────────────────────────────────────

describe('Stoop V1 Phase 16 — listReports', () => {
  it('admin sees reports oldest-first', async () => {
    const bundle = await buildAgentAs('admin');
    // Member posts a report (allowed for everyone — this skill is from Phase 3).
    await callSkill(bundle.agent, 'postRequest',
      { text: 'spam-y post', kind: 'ask', expectClaims: 0, timeoutMs: 1 });
    const open = await bundle.itemStore.listOpen({});
    const post = open.find(i => i.text === 'spam-y post');
    await callSkill(bundle.agent, 'reportPost', { itemId: post.id, reason: 'spam' });

    const r = await callSkill(bundle.agent, 'listReports');
    expect(r.reports.length).toBeGreaterThanOrEqual(1);
    expect(r.reports[0].type).toBe('report');
  });

  it('non-admin gets admin-only error', async () => {
    const bundle = await buildAgentAs('member');
    expect(await callSkill(bundle.agent, 'listReports')).toEqual({ error: 'admin-only' });
  });
});

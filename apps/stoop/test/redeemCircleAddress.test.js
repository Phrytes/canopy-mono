/**
 * Per-circle ADDRESS capture at redeem/create (identity substrate step 5B/C —
 * the roster-recording wire).
 *
 * A member presents a per-circle address (`deriveCircleAddress`) — an unlinkable,
 * circle-scoped public key that other members/software cannot correlate to the
 * addresses they present in OTHER circles. On redeem/create it is recorded on the
 * membership-redemption item AND the MemberMap row, and surfaced by
 * listGroupMembers — mirroring `sealingPublicKey`.
 *
 * Unlike the signing pubKey (bound to the AUTHENTICATED `from`), the circle
 * address is self-asserted in the body: it is the member declaring the address
 * THEY present here, not a claim about another member — so recording it verbatim
 * is safe (a joiner can only speak for their own circle address).
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';
import { createNeighborhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const BOB   = 'https://id.example/bob';
const GROUP = 'oosterpoort';
const RULES = { purpose: 'buurt', admins: [ADMIN], houseRules: ['wees aardig'] };

// Stand-in per-circle addresses (in production these come from deriveCircleAddress).
const ADMIN_ADDR = 'circle-addr-admin-oosterpoort';
const BOB_ADDR   = 'circle-addr-bob-oosterpoort';

async function callSkill(agent, skillId, args, from = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    skillMatch: { group: GROUP, localActor: ADMIN, peers: [] },
    members: [{ webid: ADMIN, role: 'admin' }],
  });
  await bundle.skillMatch.start();
  return bundle;
}

describe('redeem → capture joiner per-circle address', () => {
  it('records the joiner circle address on the redemption item + MemberMap row', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: r.code, circleAddress: BOB_ADDR }, BOB);

    const row = await bundle.members.resolveByWebid(BOB);
    expect(row.circleAddress).toBe(BOB_ADDR);

    const items = await bundle.itemStore.listOpen({ type: 'membership-redemption' });
    const mine  = items.find((i) => i?.source?.redeemedBy === BOB);
    expect(mine?.source?.circleAddress).toBe(BOB_ADDR);
  });

  it('createGroupV2 records the admin own circle address on their roster row', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'createGroupV2',
      { groupId: GROUP, name: 'X', rules: RULES, circleAddress: ADMIN_ADDR });
    const row = await bundle.members.resolveByWebid(ADMIN);
    expect(row.circleAddress).toBe(ADMIN_ADDR);
  });

  it('listGroupMembers surfaces per-circle addresses for admin + joiner', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: GROUP, name: 'X', rules: RULES, circleAddress: ADMIN_ADDR });
    await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: r.code, circleAddress: BOB_ADDR }, BOB);

    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP });
    const adminRow = out.members.find((m) => m.webid === ADMIN);
    const bobRow   = out.members.find((m) => m.webid === BOB);
    expect(adminRow?.circleAddress).toBe(ADMIN_ADDR);
    expect(bobRow?.circleAddress).toBe(BOB_ADDR);
  });

  it('listGroupMembers backfills circle address from the redemption trail on reload', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: r.code, circleAddress: BOB_ADDR }, BOB);

    // Reload where the roster row lost its circleAddress but the redemption item survives.
    await bundle.members.addMember({ webid: BOB, circleAddress: null });
    expect((await bundle.members.resolveByWebid(BOB)).circleAddress).toBeNull();

    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP });
    const bobRow = out.members.find((m) => m.webid === BOB);
    expect(bobRow?.circleAddress).toBe(BOB_ADDR);
  });

  it('back-compat: a redeem WITHOUT a circle address still works + records none', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r.code }, BOB);
    expect(redeem.redemptionId).toBeTruthy();
    expect((await bundle.members.resolveByWebid(BOB)).circleAddress).toBeNull();
    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP });
    expect(out.members.find((m) => m.webid === BOB)?.circleAddress ?? null).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { MemberMap } from '../src/MemberMap.js';
import { buildIdentitySkills } from '../src/skills.js';
import { DataPart } from '@onderling/core';

const ALICE = 'https://id.example/alice';
const BOB   = 'https://id.example/bob';

/**
 * Helper: invoke a defineSkill handler with DataPart args, return the
 * (auto-wrap-bypassed) raw return value. The skill handler returns a
 * plain object; SkillRegistry would Parts.wrap() it on a real call,
 * but for unit tests we just inspect the raw return.
 */
async function call(skillDef, args) {
  return skillDef.handler({ parts: [DataPart(args)], from: null, envelope: null });
}

describe('buildIdentitySkills', () => {
  it('resolveMember by webid returns the member record', async () => {
    const members = new MemberMap({
      initial: [{ webid: ALICE, displayName: 'Alice' }],
    });
    const [resolveMember] = buildIdentitySkills({ members });
    expect(resolveMember.id).toBe('resolveMember');
    const { member } = await call(resolveMember, { webid: ALICE });
    expect(member?.webid).toBe(ALICE);
    expect(member?.displayName).toBe('Alice');
  });

  it('resolveMember by externalId resolves to the right webid', async () => {
    const members = new MemberMap({
      initial: [{
        webid: BOB,
        displayName: 'Bob',
        externalIds: { telegramUid: '42' },
      }],
    });
    const [resolveMember] = buildIdentitySkills({ members });
    const { member } = await call(resolveMember, {
      externalIdNs: 'telegramUid',
      externalIdValue: '42',
    });
    expect(member?.webid).toBe(BOB);
  });

  it('returns {member: null} when members is null', async () => {
    const [resolveMember] = buildIdentitySkills({ members: null });
    expect(await call(resolveMember, { webid: ALICE })).toEqual({ member: null });
  });

  it('returns {member: null} when neither webid nor externalId is provided', async () => {
    const members = new MemberMap();
    const [resolveMember] = buildIdentitySkills({ members });
    expect(await call(resolveMember, {})).toEqual({ member: null });
  });
});

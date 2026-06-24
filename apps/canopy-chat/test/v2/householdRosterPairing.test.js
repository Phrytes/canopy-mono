/**
 * feedHouseholdRoster — turn a circle's member roster into no-pod household-sync peers.
 */
import { describe, it, expect, vi } from 'vitest';
import { feedHouseholdRoster } from '../../src/v2/householdRosterPairing.js';

function mkAgent({ members = [], selfAddr = 'me', skill } = {}) {
  const added = [];
  return {
    added,
    peer: { address: selfAddr },
    addHouseholdPeer: (a) => { added.push(a); },
    callSkill: skill ?? vi.fn(async (app, op) => (op === 'listGroupRoster' ? { members } : {})),
  };
}

describe('feedHouseholdRoster', () => {
  it('adds every member except self as a household peer', async () => {
    const agent = mkAgent({ members: [{ addr: 'me' }, { addr: 'laptop' }, { addr: 'phone2' }], selfAddr: 'me' });
    const n = await feedHouseholdRoster({ agent, circleId: 'c1' });
    expect(n).toBe(2);
    expect(agent.added).toEqual(['laptop', 'phone2']);
  });

  it('no-ops without an agent / addHouseholdPeer / circleId', async () => {
    expect(await feedHouseholdRoster({})).toBe(0);
    expect(await feedHouseholdRoster({ agent: { addHouseholdPeer: () => {} } })).toBe(0); // no circleId
    expect(await feedHouseholdRoster({ agent: { callSkill: () => {} }, circleId: 'c' })).toBe(0); // no addHouseholdPeer
  });

  it('stays local when the roster lookup throws (not a group / no roster)', async () => {
    const agent = mkAgent({ skill: vi.fn(async () => { throw new Error('no roster'); }) });
    expect(await feedHouseholdRoster({ agent, circleId: 'c' })).toBe(0);
    expect(agent.added).toEqual([]);
  });
});

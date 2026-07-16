/**
 * Phase 5.7a — circleEnforcement pure decision predicates.
 *
 * Three host-injection-shaped predicates wire the v2 override / policy
 * model into the inbound paths.  All tests use stub accessors so the
 * substrate stays decoupled from secure-agent / MemberMap internals.
 */
import { describe, it, expect } from 'vitest';
import {
  isInboundChatOff,
  isInboundAgentBlocked,
  shouldRouteClaimToPersonal,
} from '../../src/v2/circleEnforcement.js';

const ANNE = 'https://id.example/anne';

function stubGroupsIndex(map) {
  return { groupsFor: (w) => map[w] ?? [] };
}

function stubGetter(table) {
  return async (id) => table[id] ?? null;
}

describe('isInboundChatOff', () => {
  it('returns false when peer is not in any known circle', async () => {
    const out = await isInboundChatOff({
      peerWebid: ANNE,
      groupsIndex: stubGroupsIndex({}),
      getOverride: stubGetter({}),
    });
    expect(out).toBe(false);
  });

  it("returns true if ANY shared circle has the user's chatOff override", async () => {
    const out = await isInboundChatOff({
      peerWebid: ANNE,
      groupsIndex: stubGroupsIndex({ [ANNE]: ['circle-a', 'circle-b'] }),
      getOverride: stubGetter({ 'circle-b': { chatOff: true } }),
    });
    expect(out).toBe(true);
  });

  it('returns false when overrides exist but none have chatOff', async () => {
    const out = await isInboundChatOff({
      peerWebid: ANNE,
      groupsIndex: stubGroupsIndex({ [ANNE]: ['circle-a'] }),
      getOverride: stubGetter({ 'circle-a': { chatOff: false } }),
    });
    expect(out).toBe(false);
  });

  it('treats getOverride errors as no-override', async () => {
    const out = await isInboundChatOff({
      peerWebid: ANNE,
      groupsIndex: stubGroupsIndex({ [ANNE]: ['circle-a'] }),
      getOverride: async () => { throw new Error('store down'); },
    });
    expect(out).toBe(false);
  });

  it('rejects invalid inputs cleanly (false, no throw)', async () => {
    expect(await isInboundChatOff({})).toBe(false);
    expect(await isInboundChatOff({ peerWebid: ANNE })).toBe(false);
    expect(await isInboundChatOff({
      peerWebid: '', groupsIndex: stubGroupsIndex({}), getOverride: stubGetter({}),
    })).toBe(false);
  });
});

describe('isInboundAgentBlocked', () => {
  function stubMM(byWebid) {
    return { resolveByWebid: async (w) => byWebid[w] ?? null };
  }

  it("ignores peers whose relation isn't 'agent'", async () => {
    const out = await isInboundAgentBlocked({
      peerWebid: ANNE,
      circleId:  'circle-a',
      memberMap: stubMM({ [ANNE]: { relation: 'group-member' } }),
      getCirclePolicy: stubGetter({ 'circle-a': { agents: 'no' } }),
      getOverride: stubGetter({}),
    });
    expect(out).toBe(false);
  });

  it("circle policy 'no' is a hard veto on agent inbound", async () => {
    const out = await isInboundAgentBlocked({
      peerWebid: ANNE,
      circleId:  'circle-a',
      memberMap: stubMM({ [ANNE]: { relation: 'agent' } }),
      getCirclePolicy: stubGetter({ 'circle-a': { agents: 'no' } }),
      getOverride: stubGetter({}),
    });
    expect(out).toBe(true);
  });

  it('user override agentsMayContactMe=false also blocks', async () => {
    const out = await isInboundAgentBlocked({
      peerWebid: ANNE,
      circleId:  'circle-a',
      memberMap: stubMM({ [ANNE]: { relation: 'agent' } }),
      getCirclePolicy: stubGetter({ 'circle-a': { agents: 'admin-approval' } }),
      getOverride: stubGetter({ 'circle-a': { agentsMayContactMe: false } }),
    });
    expect(out).toBe(true);
  });

  it("circle policy 'yes' + override default → allow the agent through", async () => {
    const out = await isInboundAgentBlocked({
      peerWebid: ANNE,
      circleId:  'circle-a',
      memberMap: stubMM({ [ANNE]: { relation: 'agent' } }),
      getCirclePolicy: stubGetter({ 'circle-a': { agents: 'yes' } }),
      getOverride: stubGetter({ 'circle-a': { agentsMayContactMe: true } }),
    });
    expect(out).toBe(false);
  });

  it('rejects invalid inputs cleanly (false, no throw)', async () => {
    expect(await isInboundAgentBlocked({})).toBe(false);
    expect(await isInboundAgentBlocked({ peerWebid: ANNE, circleId: 'c' })).toBe(false);
  });
});

describe('shouldRouteClaimToPersonal', () => {
  it('true when override.flowThrough.tasksToPersonal is set', async () => {
    const out = await shouldRouteClaimToPersonal({
      circleId:   'circle-a',
      getOverride: stubGetter({ 'circle-a': { flowThrough: { tasksToPersonal: true } } }),
    });
    expect(out).toBe(true);
  });

  it('false when override is missing or the flag is off', async () => {
    expect(await shouldRouteClaimToPersonal({
      circleId: 'circle-a', getOverride: stubGetter({}),
    })).toBe(false);
    expect(await shouldRouteClaimToPersonal({
      circleId: 'circle-a',
      getOverride: stubGetter({ 'circle-a': { flowThrough: { tasksToPersonal: false } } }),
    })).toBe(false);
  });

  it('false on invalid inputs (no throw)', async () => {
    expect(await shouldRouteClaimToPersonal({})).toBe(false);
    expect(await shouldRouteClaimToPersonal({ circleId: '' })).toBe(false);
  });
});

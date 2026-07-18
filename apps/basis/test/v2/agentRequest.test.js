/**
 * agent-add admin approval tests.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldGateAgentJoin, buildAgentRequest,
  approveAgentRequest, rejectAgentRequest, pendingAgentApprovers,
  createAgentRequestStore, AGENT_REQUEST_STORE_KEY,
} from '../../src/v2/agentRequest.js';

function makeIo(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    load: (k) => (map.has(k) ? map.get(k) : null),
    save: (k, v) => { map.set(k, v); },
  };
}

describe('shouldGateAgentJoin', () => {
  it('maps the agents axis to allow/gate/block', () => {
    expect(shouldGateAgentJoin({ agents: 'yes' })).toBe('allow');
    expect(shouldGateAgentJoin({ agents: 'admin-approval' })).toBe('gate');
    expect(shouldGateAgentJoin({ agents: 'no' })).toBe('block');
  });
  it('treats missing/unknown/null policy as block (safe default per board 4B)', () => {
    expect(shouldGateAgentJoin(null)).toBe('block');
    expect(shouldGateAgentJoin({})).toBe('block');
    expect(shouldGateAgentJoin({ agents: 'bogus' })).toBe('block');
  });
});

describe('buildAgentRequest', () => {
  const baseAgent = { webid: 'a:notulist', name: 'notulist-1.5', kind: 'ollama', capabilities: ['summarise'], accessLevels: ['read-chat'] };

  it('returns status=ready when agents axis is "yes" (no gate)', () => {
    const r = buildAgentRequest({
      circleId: 'selwerd', requesterId: 'webid:pieter',
      agent: baseAgent,
      policy: { agents: 'yes', admins: ['webid:pieter', 'webid:anne'] },
    });
    expect(r.status).toBe('ready');
    expect(r.requiredApprovers).toEqual([]);
  });

  it('returns status=blocked when agents axis is "no"', () => {
    const r = buildAgentRequest({
      circleId: 'selwerd', requesterId: 'webid:pieter',
      agent: baseAgent,
      policy: { agents: 'no', admins: ['webid:pieter'] },
    });
    expect(r.status).toBe('blocked');
  });

  it('returns status=pending when gate is on + extra admins must still approve', () => {
    const r = buildAgentRequest({
      circleId: 'selwerd', requesterId: 'webid:pieter',
      agent: baseAgent,
      policy: { agents: 'admin-approval', admins: ['webid:pieter', 'webid:anne'] },
    });
    expect(r.status).toBe('pending');
    expect(r.requiredApprovers.sort()).toEqual(['webid:anne', 'webid:pieter']);
    // Requester is an admin → seeds their approval.
    expect(r.approvals).toEqual(['webid:pieter']);
    expect(pendingAgentApprovers(r)).toEqual(['webid:anne']);
  });

  it('returns status=ready when the proposing admin is the only required approver', () => {
    const r = buildAgentRequest({
      circleId: 'selwerd', requesterId: 'webid:pieter',
      agent: baseAgent,
      policy: { agents: 'admin-approval', admins: ['webid:pieter'] },
    });
    expect(r.status).toBe('ready');
  });

  it('does NOT seed the requester\'s approval when they aren\'t an admin', () => {
    const r = buildAgentRequest({
      circleId: 'selwerd', requesterId: 'webid:bob',
      agent: baseAgent,
      policy: { agents: 'admin-approval', admins: ['webid:pieter'] },
    });
    expect(r.approvals).toEqual([]);
    expect(r.status).toBe('pending');
    expect(pendingAgentApprovers(r)).toEqual(['webid:pieter']);
  });

  it('normalises the agent payload (webid/name/kind/capabilities/accessLevels)', () => {
    const r = buildAgentRequest({
      circleId: 'c', requesterId: null,
      agent: { webid: 'a', extra: 'ignored', capabilities: 'not-an-array' },
      policy: { agents: 'admin-approval', admins: ['webid:a'] },
    });
    expect(r.agent).toEqual({
      webid: 'a', name: null, kind: null, capabilities: [], accessLevels: [],
    });
  });

  it('emits an id + timestamp via the injected now()', () => {
    const r = buildAgentRequest({
      circleId: 'c', agent: baseAgent,
      policy: { agents: 'admin-approval', admins: ['webid:a'] },
      now: () => 12345,
    });
    expect(r.id).toMatch(/^agreq-/);
    expect(r.requestedAt).toBe(12345);
  });
});

describe('approveAgentRequest', () => {
  function pending(admins, requester = null) {
    return buildAgentRequest({
      circleId: 'c', requesterId: requester,
      agent: { webid: 'a:notulist' },
      policy: { agents: 'admin-approval', admins },
    });
  }

  it('records approver + flips to ready on unanimous approve', () => {
    const r0 = pending(['anne', 'pieter']);   // both required, neither approved
    const r1 = approveAgentRequest(r0, 'anne');
    expect(r1.approvals).toEqual(['anne']);
    expect(r1.status).toBe('pending');
    const r2 = approveAgentRequest(r1, 'pieter');
    expect(r2.status).toBe('ready');
  });

  it('is idempotent (same approver twice = no change)', () => {
    const r0 = pending(['anne', 'pieter']);
    const r1 = approveAgentRequest(r0, 'anne');
    const r2 = approveAgentRequest(r1, 'anne');
    expect(r2.approvals).toEqual(['anne']);
    expect(r2.status).toBe('pending');
  });

  it('refuses to mutate ready / rejected / blocked requests', () => {
    const ready = { status: 'ready', approvals: [], requiredApprovers: [], rejections: [] };
    expect(approveAgentRequest(ready, 'a')).toBe(ready);
    const rejected = { ...ready, status: 'rejected' };
    expect(approveAgentRequest(rejected, 'a')).toBe(rejected);
    const blocked  = { ...ready, status: 'blocked' };
    expect(approveAgentRequest(blocked,  'a')).toBe(blocked);
  });

  it('ignores empty / non-string approver', () => {
    const r0 = pending(['anne']);
    expect(approveAgentRequest(r0, '')).toBe(r0);
    expect(approveAgentRequest(r0, null)).toBe(r0);
    expect(approveAgentRequest(r0, 42)).toBe(r0);
  });
});

describe('rejectAgentRequest', () => {
  it('flips to rejected on any single rejection (board 4B "checkpoint, not tally")', () => {
    const r0 = buildAgentRequest({
      circleId: 'c', agent: { webid: 'a' },
      policy: { agents: 'admin-approval', admins: ['anne', 'pieter'] },
    });
    const r1 = rejectAgentRequest(r0, 'pieter');
    expect(r1.status).toBe('rejected');
    expect(r1.rejections).toEqual(['pieter']);
  });

  it('is idempotent + tolerates non-strings', () => {
    const r0 = buildAgentRequest({
      circleId: 'c', agent: { webid: 'a' },
      policy: { agents: 'admin-approval', admins: ['anne'] },
    });
    const r1 = rejectAgentRequest(r0, 'anne');
    const r2 = rejectAgentRequest(r1, 'anne');
    expect(r2).toBe(r1);              // already rejected, no change
    expect(rejectAgentRequest(r0, '')).toBe(r0);
  });
});

describe('createAgentRequestStore', () => {
  it('throws when io is missing load/save', () => {
    expect(() => createAgentRequestStore({})).toThrow(/io must provide load \+ save/);
  });

  it('save → listForCircle round-trips', async () => {
    const s = createAgentRequestStore({ io: makeIo() });
    const r = buildAgentRequest({
      circleId: 'c', requesterId: 'admin:a',
      agent: { webid: 'a:notulist' },
      policy: { agents: 'admin-approval', admins: ['admin:a', 'admin:b'] },
    });
    await s.save(r);
    expect((await s.listForCircle('c')).map((x) => x.id)).toEqual([r.id]);
  });

  it('save replaces (not duplicates) by id', async () => {
    const s = createAgentRequestStore({ io: makeIo() });
    const r0 = buildAgentRequest({
      circleId: 'c', requesterId: 'a',
      agent: { webid: 'a:n' },
      policy: { agents: 'admin-approval', admins: ['a', 'b'] },
    });
    await s.save(r0);
    const r1 = approveAgentRequest(r0, 'b');
    await s.save(r1);
    const list = await s.listForCircle('c');
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('ready');
  });

  it('remove cleans up bucket + empty circle key', async () => {
    const io = makeIo();
    const s = createAgentRequestStore({ io });
    const r = buildAgentRequest({
      circleId: 'c', agent: { webid: 'a' },
      policy: { agents: 'admin-approval', admins: ['a'] },
    });
    await s.save(r);
    await s.remove(r.id);
    expect(await s.listForCircle('c')).toEqual([]);
    expect(io.map.get(AGENT_REQUEST_STORE_KEY)?.c).toBeUndefined();
  });

  it('updateOne mutates by id atomically', async () => {
    const s = createAgentRequestStore({ io: makeIo() });
    const r0 = buildAgentRequest({
      circleId: 'c', agent: { webid: 'a' },
      policy: { agents: 'admin-approval', admins: ['a', 'b'] },
    });
    await s.save(r0);
    const updated = await s.updateOne(r0.id, (cur) => approveAgentRequest(cur, 'a'));
    expect(updated?.approvals).toContain('a');
  });

  it('countPending excludes ready/rejected/blocked', async () => {
    const s = createAgentRequestStore({ io: makeIo() });
    const ready = buildAgentRequest({
      circleId: 'c', requesterId: 'a',
      agent: { webid: 'a' },
      policy: { agents: 'admin-approval', admins: ['a'] },     // single admin = self-approve = ready
    });
    const pending = buildAgentRequest({
      circleId: 'c', requesterId: 'a',
      agent: { webid: 'b' },
      policy: { agents: 'admin-approval', admins: ['a', 'b'] }, // needs b too
    });
    await s.save(ready);
    await s.save(pending);
    expect(await s.countPending('c')).toBe(1);
  });

  it('returns [] for unknown circle', async () => {
    const s = createAgentRequestStore({ io: makeIo() });
    expect(await s.listForCircle('ghost')).toEqual([]);
    expect(await s.countPending('ghost')).toBe(0);
  });
});

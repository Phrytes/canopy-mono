import { describe, it, expect } from 'vitest';
import { circleSourcesFromAgent, makeResolvingCallSkill } from '../../src/v2/circleSources.js';
import { loadCircles } from '../../src/v2/circleModel.js';

const callSkill = async (op) => {
  if (op === 'getMyCircles') {
    return { circles: [{ circleId: 'c1', name: 'Circle', counts: { members: 3 } }] };
  }
  if (op === 'listMyBuurts') {
    return { buurts: ['selwerd', 'akkerstraat'] };
  }
  return null;
};

describe('circleSources', () => {
  it('fetchTasksCircles reads getMyCircles.circles', async () => {
    const s = circleSourcesFromAgent({ callSkill });
    expect(await s.fetchTasksCircles()).toHaveLength(1);
  });

  it('fetchGroups maps listMyBuurts groupId strings to circle objects', async () => {
    const g = await circleSourcesFromAgent({ callSkill }).fetchGroups();
    expect(g.map((x) => x.id)).toEqual(['selwerd', 'akkerstraat']);
    expect(g[0].name).toBe('selwerd');
  });

  it('omits fetchCircles without a circlesStore, uses it when present', async () => {
    expect(circleSourcesFromAgent({ callSkill }).fetchCircles).toBeUndefined();
    const circlesStore = { list: async () => [{ id: 'z', name: 'Z' }] };
    const s = circleSourcesFromAgent({ callSkill, circlesStore });
    expect(await s.fetchCircles()).toEqual([{ id: 'z', name: 'Z' }]);
  });

  it('feeds loadCircles end-to-end (circles + buurts merged + normalised)', async () => {
    const list = await loadCircles(circleSourcesFromAgent({ callSkill }));
    expect(list.map((c) => c.id).sort()).toEqual(['akkerstraat', 'c1', 'selwerd']);
    expect(list.find((c) => c.id === 'c1').memberCount).toBe(3);
  });

  it('tolerates a missing callSkill', async () => {
    const s = circleSourcesFromAgent({});
    expect(await s.fetchTasksCircles()).toEqual([]);
    expect(await s.fetchGroups()).toEqual([]);
  });
});

describe('makeResolvingCallSkill', () => {
  it('returns the first non-null result across origins, passing through op+args', async () => {
    const calls = [];
    const raw = async (app, op, args) => {
      calls.push([app, op]);
      return app === 'tasks' && op === 'getMyCircles' ? { circles: [], echoed: args.x } : null;
    };
    const resolve = makeResolvingCallSkill(raw, ['stoop', 'tasks', 'folio']);
    const res = await resolve('getMyCircles', { x: 7 });
    expect(res).toEqual({ circles: [], echoed: 7 });
    expect(calls).toEqual([['stoop', 'getMyCircles'], ['tasks', 'getMyCircles']]); // stopped at first hit
  });

  it('returns null when every origin yields null/throws or callSkill is missing', async () => {
    expect(await makeResolvingCallSkill(null)('op')).toBeNull();
    const raw = async () => { throw new Error('x'); };
    expect(await makeResolvingCallSkill(raw, ['stoop'])('op')).toBeNull();
  });
});

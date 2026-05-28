import { describe, it, expect } from 'vitest';
import { circleSourcesFromAgent } from '../../src/v2/circleSources.js';
import { loadCircles } from '../../src/v2/circleModel.js';

const callSkill = async (op) => {
  if (op === 'getMyCrews') {
    return { crews: [{ crewId: 'c1', name: 'Crew', counts: { members: 3 } }] };
  }
  if (op === 'getCurrentGroup') {
    return { group: { id: 'g1', name: 'Selwerd', memberCount: 87 } };
  }
  return null;
};

describe('circleSources', () => {
  it('fetchCrews reads getMyCrews.crews', async () => {
    const s = circleSourcesFromAgent({ callSkill });
    expect(await s.fetchCrews()).toHaveLength(1);
  });

  it('fetchGroups coerces the getCurrentGroup record to an array', async () => {
    const g = await circleSourcesFromAgent({ callSkill }).fetchGroups();
    expect(g).toHaveLength(1);
    expect(g[0].id).toBe('g1');
  });

  it('omits fetchCircles without a circlesStore, uses it when present', async () => {
    expect(circleSourcesFromAgent({ callSkill }).fetchCircles).toBeUndefined();
    const circlesStore = { list: async () => [{ id: 'z', name: 'Z' }] };
    const s = circleSourcesFromAgent({ callSkill, circlesStore });
    expect(await s.fetchCircles()).toEqual([{ id: 'z', name: 'Z' }]);
  });

  it('feeds loadCircles end-to-end (crew + group merged + normalised)', async () => {
    const list = await loadCircles(circleSourcesFromAgent({ callSkill }));
    expect(list.map((c) => c.id).sort()).toEqual(['c1', 'g1']);
    expect(list.find((c) => c.id === 'g1').memberCount).toBe(87);
    expect(list.find((c) => c.id === 'c1').memberCount).toBe(3);
  });

  it('tolerates a missing callSkill', async () => {
    const s = circleSourcesFromAgent({});
    expect(await s.fetchCrews()).toEqual([]);
    expect(await s.fetchGroups()).toEqual([]);
  });
});

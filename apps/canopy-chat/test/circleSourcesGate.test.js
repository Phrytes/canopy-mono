/**
 * Regression: circles whose source op is ABSENT from the manifest catalog must still
 * load. `listMyBuurts` (stoop) + `getMyCircles` are agent skills, not manifest ops; the
 * catalog "perf gate" used to skip them on every origin → loadCircles returned nothing
 * → "No circles yet" on reload even though the data persisted. (Fix in circleSources.js.)
 */
import { describe, it, expect } from 'vitest';
import { makeResolvingCallSkill, circleSourcesFromAgent } from '../src/v2/circleSources.js';
import { loadCircles } from '../src/v2/circleModel.js';

describe('makeResolvingCallSkill — catalog gate', () => {
  it('tries an op the catalog does NOT know on all origins (the listMyBuurts fix)', async () => {
    const calls = [];
    const raw = async (origin, opId) => {
      calls.push(`${origin}/${opId}`);
      if (origin === 'stoop' && opId === 'listMyBuurts') return { buurts: ['kleurenwiezen', 'boi'] };
      return null;
    };
    // catalog knows getMyCircles@tasks but NOTHING about listMyBuurts
    const catalog = { opsById: new Map([['tasks/getMyCircles', { appOrigin: 'tasks' }]]) };
    const callSkill = makeResolvingCallSkill(raw, undefined, () => catalog);
    const r = await callSkill('listMyBuurts', {});
    expect(r).toEqual({ buurts: ['kleurenwiezen', 'boi'] });
    expect(calls).toContain('stoop/listMyBuurts');     // stoop was NOT skipped
  });

  it('still gates a catalog-KNOWN op to its declared origin (getMyCircles → tasks only)', async () => {
    const calls = [];
    const raw = async (origin, opId) => { calls.push(origin); if (origin === 'tasks' && opId === 'getMyCircles') return { circles: [] }; return null; };
    const catalog = { opsById: new Map([['tasks/getMyCircles', { appOrigin: 'tasks' }]]) };
    const callSkill = makeResolvingCallSkill(raw, undefined, () => catalog);
    await callSkill('getMyCircles', {});
    expect(calls).not.toContain('stoop');   // skipped: catalog says getMyCircles is on tasks
    expect(calls).toContain('tasks');
  });

  it('loadCircles surfaces groups from listMyBuurts with an empty catalog', async () => {
    const raw = async (origin, opId) => (origin === 'stoop' && opId === 'listMyBuurts'
      ? { buurts: ['kleurenwiezen', 'boi', 'mai'] } : null);
    const callSkill = makeResolvingCallSkill(raw, undefined, () => ({ opsById: new Map() }));
    const circles = await loadCircles(circleSourcesFromAgent({ callSkill }));
    expect(circles.map((c) => c.id).sort()).toEqual(['boi', 'kleurenwiezen', 'mai']);
  });

  it('null catalog → tries every origin (unchanged)', async () => {
    const raw = async (origin, opId) => (origin === 'stoop' && opId === 'listMyBuurts' ? { buurts: ['x'] } : null);
    const callSkill = makeResolvingCallSkill(raw, undefined, () => null);
    expect(await callSkill('listMyBuurts', {})).toEqual({ buurts: ['x'] });
  });
});

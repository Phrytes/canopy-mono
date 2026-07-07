/**
 * V2.5 — cross-crew dashboard.
 */

import { describe, it, expect } from 'vitest';

import { aggregateCrews } from '../src/dashboard/aggregator.js';
import { dispatch } from '../src/bot/dispatch.js';
import { buildBundle } from '../src/storage/buildBundle.js';
import { createCrewAgent } from '../src/Crew.js';

const ANNE = 'https://id.example/anne';
const KID  = 'https://id.example/kid';

const CREW_A = {
  circleId: 'crew-a', name: 'Crew A', kind: 'project',
  members: [
    { webid: ANNE, displayName: 'Anne', role: 'admin' },
    { webid: KID,  displayName: 'Kid',  role: 'member' },
  ],
};
const CREW_B = {
  circleId: 'crew-b', name: 'Crew B', kind: 'household',
  members: [
    { webid: ANNE, displayName: 'Anne', role: 'admin' },
    // KID is NOT in crew B.
  ],
};

function call(crew, name, data, from) {
  return crew.agent.skills.get(name).handler({
    parts: [{ type: 'DataPart', data: data ?? {} }],
    from,
    agent: crew.agent,
    envelope: null,
  });
}

describe('V2.5 — aggregateCrews (pure)', () => {
  it('correct counters per crew', () => {
    const now = 1_000_000;
    const r = aggregateCrews({
      crews: [
        {
          crew: { circleId: 'a', name: 'A', kind: 'project' },
          openTasks: [
            { id: '1', dueAt: now - 1000, assignee: ANNE },                // overdue + mine
            { id: '2', assignee: KID, reviewLog: [{ decision: 'submit' }] }, // submitted
            { id: '3', type: 'subtask-request' },                           // ignored
          ],
        },
      ],
      actor: ANNE,
      now,
      roleOf: () => 'admin',
    });
    expect(r).toHaveLength(1);
    expect(r[0].counts).toEqual({ open: 2, overdue: 1, awaitingApproval: 1, mine: 1 });
  });

  it('sorts busiest first', () => {
    const r = aggregateCrews({
      crews: [
        { crew: { circleId: 'a', name: 'A' }, openTasks: [{ id: '1' }] },
        { crew: { circleId: 'b', name: 'B' }, openTasks: [{ id: '1' }, { id: '2' }, { id: '3' }] },
        { crew: { circleId: 'c', name: 'C' }, openTasks: [{ id: '1' }, { id: '2' }] },
      ],
      actor: ANNE,
    });
    expect(r.map((c) => c.circleId)).toEqual(['b', 'c', 'a']);
  });
});

describe('V2.5 — getMyCrews skill', () => {
  it('returns one row for the only crew (single-crew launcher)', async () => {
    const bundle = buildBundle();
    const crew = await createCrewAgent({
      crewConfig: CREW_A, localStoreBundle: bundle, wireOnboardingSkills: false,
    });
    await call(crew, 'addTask', { text: 'A1' }, ANNE);
    const r = await call(crew, 'getMyCrews', {}, ANNE);
    expect(r.crews).toHaveLength(1);
    expect(r.crews[0].circleId).toBe('crew-a');
    expect(r.crews[0].counts.open).toBe(1);
    await crew.close();
  });

  it('hides crews the actor is not a member of', async () => {
    // Build two crews on a shared store + share the bundle list via
    // crewBundlesProvider.
    const bundleA = buildBundle();
    const crewA = await createCrewAgent({
      crewConfig: CREW_A, localStoreBundle: bundleA, wireOnboardingSkills: false,
    });
    const bundleB = buildBundle();
    let crewB;
    const provider = () => {
      const list = [
        { crew: crewA.getCrew(), itemStore: crewA.itemStore, roleOf: (a) => CREW_A.members.find((m) => m.webid === a)?.role },
      ];
      if (crewB) list.push({ crew: crewB.getCrew(), itemStore: crewB.itemStore, roleOf: (a) => CREW_B.members.find((m) => m.webid === a)?.role });
      return list;
    };
    crewB = await createCrewAgent({
      crewConfig: CREW_B, localStoreBundle: bundleB, wireOnboardingSkills: false,
      crewBundlesProvider: provider,
    });

    // KID is only in CREW_A; the dashboard skill on crewB should
    // still hide CREW_B from KID.
    const r = await call(crewB, 'getMyCrews', {}, KID);
    expect(r.crews.map((c) => c.circleId)).toEqual(['crew-a']);
    await crewA.close();
    await crewB.close();
  });
});

describe('V2.5 — bot.crews', () => {
  it('dispatcher routes "crews"', () => {
    expect(dispatch('crews')).toEqual({ kind: 'skill', skillId: 'bot.crews', args: {} });
    expect(dispatch('my crews')).toEqual({ kind: 'skill', skillId: 'bot.crews', args: {} });
  });

  it('bot.crews returns one line per crew', async () => {
    const bundle = buildBundle();
    const crew = await createCrewAgent({
      crewConfig: CREW_A, localStoreBundle: bundle, wireOnboardingSkills: false,
    });
    await call(crew, 'addTask', { text: 'A1' }, ANNE);
    const def = crew.agent.skills.get('bot.crews');
    const reply = await def.handler({ parts: [], from: ANNE, agent: crew.agent, envelope: null });
    expect(reply.text).toContain('Crew A');
    expect(reply.text).toMatch(/1 open/);
    await crew.close();
  });
});

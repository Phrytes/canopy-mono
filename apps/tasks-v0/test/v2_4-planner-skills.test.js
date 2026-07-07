/**
 * V2.4 — planner skills + bot.plan/accept end-to-end.
 */

import { describe, it, expect } from 'vitest';

import { dispatch } from '../src/bot/dispatch.js';
import { buildBundle } from '../src/storage/buildBundle.js';
import { createCrewAgent } from '../src/Crew.js';

const ANNE = 'https://id.example/anne';
const KID  = 'https://id.example/kid';

const CREW = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE, displayName: 'Anne', role: 'admin' },
    { webid: KID,  displayName: 'Kid',  role: 'member' },
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

async function setup() {
  const bundle = buildBundle();
  const crew = await createCrewAgent({
    crewConfig:           CREW,
    localStoreBundle:     bundle,
    wireOnboardingSkills: false,
  });
  return { bundle, crew };
}

describe('V2.4 — planner skills', () => {
  it('dispatcher routes plan + accept', () => {
    expect(dispatch('plan')).toEqual({ kind: 'skill', skillId: 'bot.plan', args: {} });
    const a = dispatch('accept 01ABCDEF');
    expect(a).toEqual({ kind: 'skill', skillId: 'bot.accept', args: { taskId: '01abcdef', n: 1 } });
    const a2 = dispatch('accept 01ABCDEF 2');
    expect(a2.args.n).toBe(2);
  });

  it('suggestSchedule returns suggestions for own assignments only', async () => {
    const { crew } = await setup();
    const dueAt = Date.now() + 3 * 86_400_000;
    const r = await call(crew, 'addTask', { text: 'mine', dueAt, estimateMinutes: 60 }, ANNE);
    await call(crew, 'claimTask', { id: r.task.id }, KID);

    const sugg = await call(crew, 'suggestSchedule', {}, KID);
    expect(sugg.suggestions).toHaveLength(1);
    expect(sugg.suggestions[0].taskId).toBe(r.task.id);

    // Anne (not assignee) sees nothing — listOpen({assignee: ANNE}) is empty.
    const anneSugg = await call(crew, 'suggestSchedule', {}, ANNE);
    expect(anneSugg.suggestions).toEqual([]);
    await crew.close();
  });

  it('acceptSchedule sets scheduledAt; only assignee may accept', async () => {
    const { crew } = await setup();
    const dueAt = Date.now() + 3 * 86_400_000;
    const r = await call(crew, 'addTask', { text: 'pickme', dueAt, estimateMinutes: 60 }, ANNE);
    await call(crew, 'claimTask', { id: r.task.id }, KID);

    const sugg = await call(crew, 'suggestSchedule', {}, KID);
    const target = sugg.suggestions[0];
    expect(target).toBeTruthy();

    const okR = await call(crew, 'acceptSchedule', {
      taskId:    target.taskId,
      slotStart: target.slotStart,
      slotEnd:   target.slotEnd,
    }, KID);
    expect(okR.ok).toBe(true);
    expect(okR.task.scheduledAt).toBe(target.slotStart);

    // Anne (not assignee) is denied.
    const denied = await call(crew, 'acceptSchedule', {
      taskId: r.task.id, slotStart: target.slotStart, slotEnd: target.slotEnd,
    }, ANNE);
    expect(denied.error).toMatch(/assignee/);
    await crew.close();
  });

  it('rejectSchedule is a true no-op (returns ok)', async () => {
    const { crew } = await setup();
    const r = await call(crew, 'rejectSchedule', { taskId: 'fake' }, KID);
    expect(r).toEqual({ ok: true, taskId: 'fake' });
    await crew.close();
  });
});

describe('V2.4 — bot.plan / bot.accept', () => {
  it('bot.plan returns top-3; bot.accept commits the chosen suggestion', async () => {
    const { crew } = await setup();
    const dueAt = Date.now() + 3 * 86_400_000;
    const r = await call(crew, 'addTask', { text: 'pickme', dueAt, estimateMinutes: 60 }, ANNE);
    await call(crew, 'claimTask', { id: r.task.id }, KID);

    const planDef = crew.agent.skills.get('bot.plan');
    const planReply = await planDef.handler({ parts: [], from: KID, agent: crew.agent, envelope: null });
    expect(planReply.text).toMatch(/Top suggestions/);

    const accDef = crew.agent.skills.get('bot.accept');
    const accReply = await accDef.handler({
      parts: [{ type: 'DataPart', data: { taskId: r.task.id, n: 1 } }],
      from: KID, agent: crew.agent, envelope: null,
    });
    expect(accReply.text).toMatch(/Accepted/);

    const updated = await crew.itemStore.getById(r.task.id);
    expect(updated.scheduledAt).toBeGreaterThan(0);
    await crew.close();
  });

  it('bot.accept without a matching suggestion replies with the friendly hint', async () => {
    const { crew } = await setup();
    const accDef = crew.agent.skills.get('bot.accept');
    const reply = await accDef.handler({
      parts: [{ type: 'DataPart', data: { taskId: 'nonexistent', n: 1 } }],
      from: KID, agent: crew.agent, envelope: null,
    });
    expect(reply.text).toMatch(/no suggestions/i);
    await crew.close();
  });
});

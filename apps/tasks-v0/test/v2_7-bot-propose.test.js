/**
 * V2.7 — bot-side propose / accept / decline / proposals / force-complete.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { dispatch } from '../src/bot/dispatch.js';
import { buildBundle } from '../src/storage/buildBundle.js';
import { createCrewAgent } from '../src/Crew.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CREW = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
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

describe('V2.7 — dispatch parses propose / accept / decline / proposals / force-complete', () => {
  it('"propose <pid> <text>"', () => {
    const a = dispatch('propose 01abcdef add gate hinge');
    expect(a.skillId).toBe('bot.propose');
    expect(a.args.parentTaskId).toBe('01abcdef');
    expect(a.args.text).toBe('add gate hinge');
  });
  it('"propose" alone replies with usage hint', () => {
    expect(dispatch('propose').kind).toBe('reply');
  });
  it('"accept-proposal <id>"', () => {
    expect(dispatch('accept-proposal 01ABCDEF')).toEqual({
      kind: 'skill', skillId: 'bot.acceptProposal', args: { proposalId: '01abcdef' },
    });
  });
  it('"decline-proposal <id> reason: …"', () => {
    const a = dispatch('decline-proposal 01ABCDEF reason: not now');
    expect(a.skillId).toBe('bot.declineProposal');
    expect(a.args.proposalId).toBe('01abcdef');
    expect(a.args.note).toBe('not now');
  });
  it('"proposals"', () => {
    expect(dispatch('proposals')).toEqual({
      kind: 'skill', skillId: 'bot.listProposals', args: {},
    });
  });
  it('"force-complete <id> reason: …"', () => {
    const a = dispatch('force-complete 01ABCDEF reason: project cancelled');
    expect(a.skillId).toBe('bot.forceComplete');
    expect(a.args.id).toBe('01abcdef');
    expect(a.args.reason).toBe('project cancelled');
  });
  it('"force-complete" without a reason → reply', () => {
    const a = dispatch('force-complete 01ABCDEF anything');
    expect(a.kind).toBe('reply');
    expect(a.text).toMatch(/reason/i);
  });
});

describe('V2.7 — bot.* propose flow end-to-end', () => {
  let crew;
  beforeEach(async () => { ({ crew } = await setup()); });

  it('full propose → accept flow renders and commits', async () => {
    const p = await call(crew, 'addTask', { text: 'Paint fence', approval: 'creator' }, ANNE);
    await call(crew, 'claimTask',  { id: p.task.id }, KID);
    await call(crew, 'submitTask', { id: p.task.id }, KID);

    // Coordinator proposes via bot.
    const propose = crew.agent.skills.get('bot.propose');
    const r1 = await propose.handler({
      parts: [{ type: 'DataPart', data: { parentTaskId: p.task.id, text: 'add gate hinge' } }],
      from: FRITS, agent: crew.agent, envelope: null,
    });
    expect(r1.text).toMatch(/Proposed sub-task to kid/i);

    // Assignee lists their proposals via bot.
    const list = crew.agent.skills.get('bot.listProposals');
    const r2 = await list.handler({ parts: [], from: KID, agent: crew.agent, envelope: null });
    expect(r2.text).toMatch(/waiting/);
    expect(r2.text).toMatch(/add gate hinge/);

    // Pull the proposalId from the rendered text — short-id only;
    // resolve to the full id via getById prefix walk.
    const open = await crew.itemStore.listOpen({ type: 'subtask-proposal' });
    const proposal = open[0];

    // Assignee approves via bot.
    const accept = crew.agent.skills.get('bot.acceptProposal');
    const r3 = await accept.handler({
      parts: [{ type: 'DataPart', data: { proposalId: proposal.id } }],
      from: KID, agent: crew.agent, envelope: null,
    });
    expect(r3.text).toMatch(/spawned/);
    expect(r3.text).toMatch(/rolled back/);

    // Parent should be back to claimed (not submitted).
    const parent = await crew.itemStore.getById(p.task.id);
    expect(parent.assignee).toBe(KID);
    const reject = (parent.reviewLog ?? []).find((e) => e.decision === 'reject');
    expect(reject?.note).toMatch(/auto-rollback/);
  });

  it('decline flow keeps the submission valid', async () => {
    const p = await call(crew, 'addTask', { text: 'Paint', approval: 'creator' }, ANNE);
    await call(crew, 'claimTask',  { id: p.task.id }, KID);
    await call(crew, 'submitTask', { id: p.task.id }, KID);
    await call(crew, 'proposeSubtask',
      { parentTaskId: p.task.id, text: 'extra' }, ANNE);
    const open = await crew.itemStore.listOpen({ type: 'subtask-proposal' });
    const proposal = open[0];

    const decline = crew.agent.skills.get('bot.declineProposal');
    const r = await decline.handler({
      parts: [{ type: 'DataPart', data: { proposalId: proposal.id, note: 'not now' } }],
      from: KID, agent: crew.agent, envelope: null,
    });
    expect(r.text).toMatch(/Declined/);
    expect(r.text).toMatch(/stays valid/);

    // Parent should still be approvable by Anne.
    const ap = await call(crew, 'approveTask', { id: p.task.id }, ANNE);
    expect(ap.task?.completedAt).toBeGreaterThan(0);
  });

  it('bot.forceComplete admin-only; mandatory reason; bypasses gate', async () => {
    const p = await call(crew, 'addTask', { text: 'Parent' }, ANNE);
    await call(crew, 'addSubtask', { parentTaskId: p.task.id, text: 'Child' }, ANNE);

    const force = crew.agent.skills.get('bot.forceComplete');
    const denied = await force.handler({
      parts: [{ type: 'DataPart', data: { id: p.task.id, reason: 'r' } }],
      from: KID, agent: crew.agent, envelope: null,
    });
    expect(denied.text).toMatch(/admin/);

    const ok = await force.handler({
      parts: [{ type: 'DataPart', data: { id: p.task.id, reason: 'project cancelled' } }],
      from: ANNE, agent: crew.agent, envelope: null,
    });
    expect(ok.text).toMatch(/Force-completed/);
    const closed = await crew.itemStore.getById(p.task.id);
    expect(closed.completedAt).toBeGreaterThan(0);
  });

  it('bot.listProposals returns empty-state when nothing waiting', async () => {
    const list = crew.agent.skills.get('bot.listProposals');
    const r = await list.handler({ parts: [], from: KID, agent: crew.agent, envelope: null });
    expect(r.text).toMatch(/No subtask-proposals/i);
  });
});

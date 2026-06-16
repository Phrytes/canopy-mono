/**
 * S6.A — reply → inline manifest buttons. Uses the REAL tasks manifest so the
 * appliesTo gating (a task's state decides which buttons show) is verified
 * against the contract the bot actually composes.
 */
import { describe, it, expect } from 'vitest';
import { snapshotsFromReply, embedButtonsForReply } from '../src/v2/replyEmbeds.js';
import { mockTasksManifest } from '../src/core/manifests/mockManifests.js';

const manifestsByOrigin = { 'tasks-v0': mockTasksManifest };

describe('snapshotsFromReply', () => {
  it('extracts a single created task + defaults its type from the appOrigin', () => {
    const snaps = snapshotsFromReply({ task: { id: 't1', state: 'open', label: 'boodschappen' } }, { appOrigin: 'tasks-v0' });
    expect(snaps).toEqual([{ id: 't1', type: 'task', state: 'open', label: 'boodschappen', fields: { id: 't1', state: 'open', label: 'boodschappen' } }]);
  });
  it('extracts a list (items/tasks) + dedups by id', () => {
    const snaps = snapshotsFromReply({ items: [{ id: 'a', state: 'open' }, { id: 'b', state: 'claimed' }, { id: 'a', state: 'open' }] }, { appOrigin: 'tasks-v0' });
    expect(snaps.map((s) => s.id)).toEqual(['a', 'b']);
  });
  it('reads payload-wrapped replies + non-object → []', () => {
    expect(snapshotsFromReply({ payload: { tasks: [{ id: 'x', state: 'open' }] } }, { appOrigin: 'tasks-v0' })[0].id).toBe('x');
    expect(snapshotsFromReply(null, { appOrigin: 'tasks-v0' })).toEqual([]);
  });
});

describe('embedButtonsForReply (real tasks manifest, appliesTo-gated)', () => {
  it('an OPEN task offers Claim (state=open button) not Mark complete (state=claimed)', () => {
    const btns = embedButtonsForReply({ reply: { task: { id: 't1', state: 'open', label: 'boodschappen' } }, appOrigin: 'tasks-v0', manifestsByOrigin });
    const ops = btns.map((b) => b.opId);
    expect(ops).toContain('claimTask');
    expect(ops).not.toContain('completeTask');   // gated out: completeTask is state:['claimed']
    expect(btns[0]).toMatchObject({ opId: 'claimTask', itemId: 't1' });
    expect(btns.find((b) => b.opId === 'claimTask').label).toMatch(/Claim/);
  });

  it('a CLAIMED task offers Mark complete + Submit, not Claim', () => {
    const btns = embedButtonsForReply({ reply: { task: { id: 't2', state: 'claimed', label: 'lekkage' } }, appOrigin: 'tasks-v0', manifestsByOrigin });
    const ops = btns.map((b) => b.opId);
    expect(ops).toContain('completeTask');
    expect(ops).toContain('submitTask');
    expect(ops).not.toContain('claimTask');
  });

  it('builds one button set per item across a list, keyed opId:itemId', () => {
    const btns = embedButtonsForReply({
      reply: { tasks: [{ id: 'a', state: 'open' }, { id: 'b', state: 'claimed' }] },
      appOrigin: 'tasks-v0', manifestsByOrigin,
    });
    expect(btns.some((b) => b.id === 'claimTask:a')).toBe(true);
    expect(btns.some((b) => b.id === 'completeTask:b')).toBe(true);
  });

  it('returns [] without a manifest or appOrigin', () => {
    expect(embedButtonsForReply({ reply: { task: { id: 't', state: 'open' } } })).toEqual([]);
  });
});

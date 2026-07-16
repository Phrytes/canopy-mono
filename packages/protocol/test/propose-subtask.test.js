/**
 * propose-subtask — end-to-end exercise of the canonical first
 * consumer protocol.
 */

import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createProtocolOrchestrator } from '../src/orchestrator.js';
import { PROPOSE_SUBTASK } from '../src/protocols/propose-subtask.js';

const ANNE = 'agent://anne';
const BOB  = 'agent://bob';

function mkOrch() {
  const pseudoPod = createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId: 'd1',
  });
  const orch = createProtocolOrchestrator({ pseudoPod, deviceId: 'd1' });
  orch.registerProtocol(PROPOSE_SUBTASK);
  return orch;
}

const VALID_CTX = {
  proposer:     ANNE,
  assignee:     BOB,
  parentTaskId: 'task-parent-1',
  body:         'please paint the fence first',
};

describe('propose-subtask — happy path', () => {
  it('proposed → accepted by the right assignee', async () => {
    const orch = mkOrch();
    const inst = await orch.start('propose-subtask', VALID_CTX);
    expect(inst.state).toBe('proposed');

    const next = await orch.step(inst.instanceId, 'accept', {
      actor:     BOB,
      subtaskId: 'task-sub-1',
    });
    expect(next.state).toBe('accepted');
    expect(next.context.subtaskId).toBe('task-sub-1');
    expect(typeof next.context.acceptedAt).toBe('string');
  });

  it('proposed → declined (with optional note)', async () => {
    const orch = mkOrch();
    const inst = await orch.start('propose-subtask', VALID_CTX);
    const next = await orch.step(inst.instanceId, 'decline', {
      actor: BOB,
      note:  'busy this week',
    });
    expect(next.state).toBe('declined');
    expect(next.context.declineNote).toBe('busy this week');
  });

  it('proposed → withdrawn by the proposer', async () => {
    const orch = mkOrch();
    const inst = await orch.start('propose-subtask', VALID_CTX);
    const next = await orch.step(inst.instanceId, 'withdraw', { actor: ANNE });
    expect(next.state).toBe('withdrawn');
    expect(typeof next.context.withdrawnAt).toBe('string');
  });

  it('proposed → expired on TTL event', async () => {
    const orch = mkOrch();
    const inst = await orch.start('propose-subtask', VALID_CTX);
    const next = await orch.step(inst.instanceId, 'expire');
    expect(next.state).toBe('expired');
    expect(typeof next.context.expiredAt).toBe('string');
  });
});

describe('propose-subtask — guards', () => {
  it('rejects accept when actor is not the assignee', async () => {
    const orch = mkOrch();
    const inst = await orch.start('propose-subtask', VALID_CTX);
    await expect(orch.step(inst.instanceId, 'accept', { actor: 'agent://eve' }))
      .rejects.toMatchObject({ code: 'GUARD_REJECTED' });
  });

  it('rejects decline when actor is not the assignee', async () => {
    const orch = mkOrch();
    const inst = await orch.start('propose-subtask', VALID_CTX);
    await expect(orch.step(inst.instanceId, 'decline', { actor: ANNE }))
      .rejects.toMatchObject({ code: 'GUARD_REJECTED' });
  });

  it('rejects withdraw when actor is not the proposer', async () => {
    const orch = mkOrch();
    const inst = await orch.start('propose-subtask', VALID_CTX);
    await expect(orch.step(inst.instanceId, 'withdraw', { actor: BOB }))
      .rejects.toMatchObject({ code: 'GUARD_REJECTED' });
  });
});

describe('propose-subtask — initial validator', () => {
  it('rejects missing required context fields', async () => {
    const orch = mkOrch();
    await expect(orch.start('propose-subtask', {
      proposer: ANNE, assignee: BOB, parentTaskId: 'p1',
      // missing body
    })).rejects.toMatchObject({ code: 'INVALID_INITIAL_CONTEXT' });

    await expect(orch.start('propose-subtask', {
      proposer: ANNE, assignee: BOB, body: 'hello',
      // missing parentTaskId
    })).rejects.toMatchObject({ code: 'INVALID_INITIAL_CONTEXT' });
  });

  it('rejects empty body', async () => {
    const orch = mkOrch();
    await expect(orch.start('propose-subtask', { ...VALID_CTX, body: '' }))
      .rejects.toMatchObject({ code: 'INVALID_INITIAL_CONTEXT' });
  });
});

describe('propose-subtask — terminal states reject further steps', () => {
  it('accepted is terminal', async () => {
    const orch = mkOrch();
    const inst = await orch.start('propose-subtask', VALID_CTX);
    await orch.step(inst.instanceId, 'accept', { actor: BOB });
    await expect(orch.step(inst.instanceId, 'decline', { actor: BOB }))
      .rejects.toMatchObject({ code: 'NO_TRANSITION' });
    await expect(orch.step(inst.instanceId, 'accept', { actor: BOB }))
      .rejects.toMatchObject({ code: 'NO_TRANSITION' });
  });

  it('declined is terminal', async () => {
    const orch = mkOrch();
    const inst = await orch.start('propose-subtask', VALID_CTX);
    await orch.step(inst.instanceId, 'decline', { actor: BOB });
    await expect(orch.step(inst.instanceId, 'accept', { actor: BOB }))
      .rejects.toMatchObject({ code: 'NO_TRANSITION' });
  });
});

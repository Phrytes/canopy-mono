import { describe, it, expect } from 'vitest';
import { makeProposal, approveProposal, pendingApprovers } from '../../src/v2/circleConsensus.js';

describe('circleConsensus · makeProposal', () => {
  it('applies immediately (ready) when consensus is off', () => {
    const p = makeProposal({
      circleId: 'c1', patch: { pod: 'shared' }, proposedBy: 'anne',
      policy: { admins: ['anne', 'pieter'], consensusRequired: false },
    });
    expect(p.status).toBe('ready');
    expect(p.patch).toEqual({ pod: 'shared' });
  });

  it('applies immediately when there is a single admin even if consensus is on', () => {
    const p = makeProposal({
      circleId: 'c1', patch: { pod: 'shared' }, proposedBy: 'anne',
      policy: { admins: ['anne'], consensusRequired: true },
    });
    expect(p.status).toBe('ready');
  });

  it('is pending when consensus is on with 2+ admins (proposer auto-approves)', () => {
    const p = makeProposal({
      circleId: 'c1', patch: { llmTool: 'local' }, proposedBy: 'anne',
      policy: { admins: ['anne', 'pieter'], consensusRequired: true },
    });
    expect(p.status).toBe('pending');
    expect(p.approvals).toEqual(['anne']);
    expect(pendingApprovers(p)).toEqual(['pieter']);
  });
});

describe('circleConsensus · approveProposal', () => {
  it('flips to ready once the last required approver approves', () => {
    let p = makeProposal({
      circleId: 'c1', patch: { agents: 'no' }, proposedBy: 'anne',
      policy: { admins: ['anne', 'pieter'], consensusRequired: true },
    });
    p = approveProposal(p, 'anne');   // idempotent re-approve
    expect(p.status).toBe('pending');
    p = approveProposal(p, 'pieter');
    expect(p.status).toBe('ready');
    expect(pendingApprovers(p)).toEqual([]);
  });

  it('is a no-op once ready', () => {
    const ready = makeProposal({
      circleId: 'c1', patch: {}, proposedBy: 'anne',
      policy: { admins: ['anne'], consensusRequired: true },
    });
    expect(approveProposal(ready, 'pieter')).toBe(ready);
  });
});

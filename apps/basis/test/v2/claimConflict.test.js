/**
 * (PLAN-task-claim-partition) — the claim-conflict SURFACE reuses
 * recipeConflict. A recorded double-claim maps to a one-block recipe conflict
 * so the existing yours/theirs/both resolver drives the card.
 */
import { describe, it, expect } from 'vitest';
import { detectClaimConflict, resolveClaimConflict } from '../../src/v2/claimConflict.js';

const conflict = {
  taskId:           'T-123',
  text:             'shovel the path',
  localAssignee:    'https://id.example/bob',
  incomingAssignee: 'https://id.example/ann',
};

describe('claimConflict surface (reuses recipeConflict)', () => {
  it('detects exactly one block-conflict (the disputed assignment)', () => {
    const report = detectClaimConflict(conflict);
    expect(report.identical).toBe(false);
    expect(report.blockConflicts.length).toBe(1);
    expect(report.blockConflicts[0].blockId).toBe('claim:T-123');
  });

  it("'yours' keeps only the local claimant", () => {
    expect(resolveClaimConflict(conflict, 'yours')).toEqual([conflict.localAssignee]);
  });

  it("'theirs' keeps only the incoming claimant", () => {
    expect(resolveClaimConflict(conflict, 'theirs')).toEqual([conflict.incomingAssignee]);
  });

  it("'both' keeps BOTH claimants (incoming under a fresh id)", () => {
    const survivors = resolveClaimConflict(conflict, 'both');
    expect(survivors).toContain(conflict.localAssignee);
    expect(survivors).toContain(conflict.incomingAssignee);
    expect(survivors.length).toBe(2);
  });
});

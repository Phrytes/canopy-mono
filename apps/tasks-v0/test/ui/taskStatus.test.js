/**
 * taskStatus — pure-fn coverage for the V2.7-aware UI gate helpers.
 *
 * Phase 41.4.9 (2026-05-09); lifted 2026-05-10 alongside
 * `apps/tasks-v0/src/ui/taskStatus.js` per the shared-UI-glue rule
 * (Project Files/conventions/architectural-layering.md). Both web
 * and mobile shells consume this helper; this test is the only
 * coverage — the mobile shell's old re-export module needs no
 * separate test of its own.
 */

import { describe, it, expect } from 'vitest';
import {
  describeTaskStatus,
  shouldOfferForceComplete,
  shouldProposeSubtask,
} from '../../src/ui/taskStatus.js';

const ANNE = 'webid://anne';
const BOB  = 'webid://bob';

describe('describeTaskStatus — kind + colorKey', () => {
  it('maps each known status to a stable colorKey', () => {
    expect(describeTaskStatus({ status: 'ready' }).colorKey).toBe('info');
    expect(describeTaskStatus({ status: 'waiting' }).colorKey).toBe('warning');
    expect(describeTaskStatus({ status: 'blocked' }).colorKey).toBe('danger');
    expect(describeTaskStatus({ status: 'claimed' }).colorKey).toBe('primary');
    expect(describeTaskStatus({ status: 'submitted' }).colorKey).toBe('success');
    expect(describeTaskStatus({ status: 'complete' }).colorKey).toBe('textMuted');
    expect(describeTaskStatus({ status: 'rejected' }).colorKey).toBe('danger');
  });
  it('falls back to unknown for missing/garbage input', () => {
    expect(describeTaskStatus({}).kind).toBe('unknown');
    expect(describeTaskStatus({ status: 'garbage' }).kind).toBe('unknown');
    expect(describeTaskStatus(null).kind).toBe('unknown');
  });
});

describe('describeTaskStatus — depsBlocked / canClose', () => {
  it('depsBlocked=true for waiting + blocked', () => {
    expect(describeTaskStatus({ status: 'waiting' }).depsBlocked).toBe(true);
    expect(describeTaskStatus({ status: 'blocked' }).depsBlocked).toBe(true);
  });
  it('canClose=true ONLY for claimed/submitted without deps', () => {
    expect(describeTaskStatus({ status: 'claimed' }).canClose).toBe(true);
    expect(describeTaskStatus({ status: 'submitted' }).canClose).toBe(true);
    expect(describeTaskStatus({ status: 'ready' }).canClose).toBe(false);
    expect(describeTaskStatus({ status: 'waiting' }).canClose).toBe(false);
  });
  it('exposes openDepIds when status === waiting', () => {
    const s = describeTaskStatus({
      status: 'waiting',
      openDeps: ['urn:uuid:abcdef-aaaa-bbbb-cccc-123456abcdef',
                 'urn:uuid:111111-2222-3333-4444-aaaaaaaa1234'],
    });
    expect(s.openDepIds).toHaveLength(2);
    // Each entry is the trailing 6 chars (consistent with the helper).
    expect(s.openDepIds[0]).toMatch(/^[\w-]{6}$/);
  });

  it('claimed-but-deps-open still gates canClose (V2.7 hard-deps)', () => {
    // After 41.18, listOpen returns lifecycle status (claimed) and a
    // separate openDeps[]. The UI must still pre-disable Mark-complete
    // because the substrate's enforceDependencies will reject a tap.
    const s = describeTaskStatus({
      status: 'claimed',
      assignee: 'webid://anne',
      openDeps: ['t-blocking'],
    });
    expect(s.depsBlocked).toBe(true);
    expect(s.canClose).toBe(false);
    expect(s.openDepIds).toEqual(['ocking']);
  });

  it('submitted-but-deps-open also gates canClose (Approve disabled)', () => {
    const s = describeTaskStatus({
      status: 'submitted',
      assignee: 'webid://anne',
      openDeps: ['t-1', 't-2'],
    });
    expect(s.depsBlocked).toBe(true);
    expect(s.canClose).toBe(false);
  });

  it('claimed with empty openDeps is fully closable', () => {
    const s = describeTaskStatus({
      status: 'claimed', assignee: 'x', openDeps: [],
    });
    expect(s.depsBlocked).toBe(false);
    expect(s.canClose).toBe(true);
  });
});

describe('describeTaskStatus — isAssignee / isMaster', () => {
  it('matches assignee', () => {
    const s = describeTaskStatus({ status: 'claimed', assignee: ANNE });
    expect(s.isAssignee(ANNE)).toBe(true);
    expect(s.isAssignee(BOB)).toBe(false);
  });
  it('master falls back to addedBy', () => {
    const s1 = describeTaskStatus({ master: ANNE });
    const s2 = describeTaskStatus({ addedBy: ANNE });
    expect(s1.isMaster(ANNE)).toBe(true);
    expect(s2.isMaster(ANNE)).toBe(true);
    expect(s1.isMaster(BOB)).toBe(false);
  });
});

describe('shouldOfferForceComplete — V2.7 admin override gate', () => {
  it('renders the CTA when admin/coord + deps-blocked + not complete', () => {
    const item = { status: 'waiting' };
    expect(shouldOfferForceComplete(item, ANNE, 'admin')).toBe(true);
    expect(shouldOfferForceComplete(item, ANNE, 'coordinator')).toBe(true);
  });
  it('hidden when caller isn\'t admin/coord', () => {
    expect(shouldOfferForceComplete({ status: 'waiting' }, ANNE, 'member')).toBe(false);
  });
  it('hidden when not deps-blocked', () => {
    expect(shouldOfferForceComplete({ status: 'claimed' }, ANNE, 'admin')).toBe(false);
  });
  it('hidden when already complete', () => {
    expect(shouldOfferForceComplete({ status: 'complete' }, ANNE, 'admin')).toBe(false);
  });
});

describe('shouldProposeSubtask — V2.7 propose-mode gate', () => {
  it('true when parent is submitted and caller isn\'t the assignee', () => {
    const parent = { status: 'submitted', assignee: BOB };
    expect(shouldProposeSubtask(parent, ANNE)).toBe(true);
  });
  it('false when caller IS the assignee (self-spawn)', () => {
    const parent = { status: 'submitted', assignee: ANNE };
    expect(shouldProposeSubtask(parent, ANNE)).toBe(false);
  });
  it('false when parent isn\'t submitted', () => {
    const parent = { status: 'claimed', assignee: BOB };
    expect(shouldProposeSubtask(parent, ANNE)).toBe(false);
  });
});

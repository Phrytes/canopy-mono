/**
 * taskStatus — pure-fn coverage for the V2.7-aware UI gate helpers.
 *
 * Phase 41.4.9 (2026-05-09).
 */

import { describe, it, expect } from 'vitest';
import {
  describeTaskStatus,
  shouldOfferForceComplete,
  shouldProposeSubtask,
} from '../../src/lib/taskStatus.js';

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

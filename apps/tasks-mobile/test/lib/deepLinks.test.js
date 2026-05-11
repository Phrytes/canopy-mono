/**
 * deepLinks — Tasks-mobile parser coverage.
 *
 * Phase 41.15.3 (2026-05-09).
 */

import { describe, it, expect } from 'vitest';
import { parseDeepLink, actionToNavigation } from '../../src/lib/deepLinks.js';
import { ROUTES } from '../../src/navigation.js';

describe('parseDeepLink — Tasks scheme', () => {
  it('classifies tasks:// (root) as welcome', () => {
    expect(parseDeepLink('tasks://').kind).toBe('welcome');
  });
  it('classifies tasks://welcome', () => {
    expect(parseDeepLink('tasks://welcome').kind).toBe('welcome');
  });
  it('classifies tasks://workspace', () => {
    expect(parseDeepLink('tasks://workspace').kind).toBe('workspace');
  });
  it('classifies tasks://auth/callback?code=abc', () => {
    const r = parseDeepLink('tasks://auth/callback?code=abc&state=xyz');
    expect(r.kind).toBe('auth_callback');
    expect(r.params.code).toBe('abc');
    expect(r.params.state).toBe('xyz');
  });
  it('classifies tasks://post?id=t1 → post', () => {
    expect(parseDeepLink('tasks://post?id=t1').kind).toBe('post');
  });
  it('classifies tasks://crew?id=c1 → crew', () => {
    expect(parseDeepLink('tasks://crew?id=c1').kind).toBe('crew');
  });
  it('classifies invite with valid token (signed)', () => {
    const token = JSON.stringify({ groupId: 'crew-a', signature: 'sig' });
    const url = `tasks://invite?token=${encodeURIComponent(token)}`;
    expect(parseDeepLink(url).kind).toBe('invite');
  });
  it('classifies invite with code', () => {
    const token = JSON.stringify({ groupId: 'crew-a', code: 'short-code' });
    const url = `tasks://invite?token=${encodeURIComponent(token)}`;
    expect(parseDeepLink(url).kind).toBe('invite');
  });
  it('rejects invite without groupId', () => {
    const token = JSON.stringify({ signature: 'sig' });
    const url = `tasks://invite?token=${encodeURIComponent(token)}`;
    expect(parseDeepLink(url).kind).toBe('unknown');
  });
  it('returns unknown for non-tasks scheme', () => {
    expect(parseDeepLink('stoop://welcome').kind).toBe('unknown');
  });
});

describe('actionToNavigation', () => {
  it('maps welcome → ROUTES.Welcome', () => {
    expect(actionToNavigation({ kind: 'welcome' })).toEqual({
      name: ROUTES.Welcome,
      params: undefined,
    });
  });
  it('maps auth_callback → AuthCallback', () => {
    const r = actionToNavigation({ kind: 'auth_callback', params: { code: 'abc' } });
    expect(r.name).toBe(ROUTES.AuthCallback);
    expect(r.params.code).toBe('abc');
  });
  it('maps post → TaskDetail with {id}', () => {
    const r = actionToNavigation({ kind: 'post', params: { id: 't1' } });
    expect(r.name).toBe(ROUTES.TaskDetail);
    expect(r.params.id).toBe('t1');
  });
  it('maps crew → Workspace with {crewId}', () => {
    const r = actionToNavigation({ kind: 'crew', params: { id: 'c1' } });
    expect(r.name).toBe(ROUTES.Workspace);
    expect(r.params.crewId).toBe('c1');
  });
  it('maps invite → OnboardScan with pendingInvite', () => {
    const r = actionToNavigation({ kind: 'invite', params: { token: { groupId: 'x', code: 'y' } } });
    expect(r.name).toBe(ROUTES.OnboardScan);
    expect(r.params.pendingInvite).toEqual({ groupId: 'x', code: 'y' });
  });
  it('returns null for unknown', () => {
    expect(actionToNavigation({ kind: 'unknown' })).toBeNull();
    expect(actionToNavigation(null)).toBeNull();
  });

  it('maps appeal deep-link → ChatThread with appeal:<taskId>', () => {
    const r = actionToNavigation({ kind: 'appeal', params: { taskId: 't-42' } });
    expect(r.name).toBe(ROUTES.ChatThread);
    expect(r.params.threadId).toBe('appeal:t-42');
    expect(r.params.appealForTaskId).toBe('t-42');
  });

  it('maps chat deep-link → ChatThread', () => {
    const r = actionToNavigation({
      kind:   'chat',
      params: { threadId: 'tid', counterparty: 'webid://x' },
    });
    expect(r.name).toBe(ROUTES.ChatThread);
    expect(r.params.threadId).toBe('tid');
    expect(r.params.counterparty).toBe('webid://x');
  });
});

describe('parseDeepLink — appeal/chat (Phase 41.18.4)', () => {
  it('parses tasks://appeal?taskId=t-42 → kind appeal', () => {
    expect(parseDeepLink('tasks://appeal?taskId=t-42').kind).toBe('appeal');
    expect(parseDeepLink('tasks://appeal?taskId=t-42').params.taskId).toBe('t-42');
  });

  it('parses tasks://chat?threadId=foo → kind chat', () => {
    expect(parseDeepLink('tasks://chat?threadId=foo').kind).toBe('chat');
    expect(parseDeepLink('tasks://chat?threadId=foo').params.threadId).toBe('foo');
  });

  it('appeal without taskId returns unknown', () => {
    expect(parseDeepLink('tasks://appeal').kind).toBe('unknown');
  });

  it('chat without threadId returns unknown', () => {
    expect(parseDeepLink('tasks://chat').kind).toBe('unknown');
  });
});

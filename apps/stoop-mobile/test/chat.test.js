/**
 * chat — pure-helper coverage for ChatThreads / ChatThread screens.
 */

import { describe, it, expect } from 'vitest';
import {
  sortThreadsByActivity, formatUnreadBadge, validateChatDraft,
  groupConsecutive, UNREAD_BADGE_CAP, CHAT_MAX_BODY_LEN,
} from '../src/lib/chat.js';

describe('sortThreadsByActivity', () => {
  it('most-recent first', () => {
    const r = sortThreadsByActivity([
      { id: 'a', lastActivity: 100 },
      { id: 'b', lastActivity: 300 },
      { id: 'c', lastActivity: 200 },
    ]);
    expect(r.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('threads without activity sink to bottom', () => {
    const r = sortThreadsByActivity([
      { id: 'a', lastActivity: 100 },
      { id: 'b' },
      { id: 'c', lastActivity: 50 },
    ]);
    expect(r.map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });

  it('preserves array on identical activity (id-stable)', () => {
    const r = sortThreadsByActivity([
      { id: 'a', lastActivity: 1 },
      { id: 'b', lastActivity: 1 },
    ]);
    expect(r.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('returns [] for non-arrays', () => {
    expect(sortThreadsByActivity(null)).toEqual([]);
  });

  it('returns a copy', () => {
    const orig = [{ id: 'a', lastActivity: 1 }];
    const r = sortThreadsByActivity(orig);
    expect(r).not.toBe(orig);
  });
});

describe('formatUnreadBadge', () => {
  it('null for 0 / negative / non-number', () => {
    expect(formatUnreadBadge(0)).toBeNull();
    expect(formatUnreadBadge(-1)).toBeNull();
    expect(formatUnreadBadge(null)).toBeNull();
    expect(formatUnreadBadge(NaN)).toBeNull();
  });
  it('"<n>" up to the cap', () => {
    expect(formatUnreadBadge(1)).toBe('1');
    expect(formatUnreadBadge(UNREAD_BADGE_CAP)).toBe(String(UNREAD_BADGE_CAP));
  });
  it('"<cap>+" past the cap', () => {
    expect(formatUnreadBadge(UNREAD_BADGE_CAP + 1)).toBe(`${UNREAD_BADGE_CAP}+`);
    expect(formatUnreadBadge(999)).toBe(`${UNREAD_BADGE_CAP}+`);
  });
});

describe('validateChatDraft', () => {
  it('accepts text-only', () => {
    expect(validateChatDraft({ text: 'hi' })).toEqual({ ok: true });
  });
  it('accepts attachment-only', () => {
    expect(validateChatDraft({ attachment: { uri: 'x' } })).toEqual({ ok: true });
  });
  it('rejects no-content', () => {
    expect(validateChatDraft({})).toEqual({ ok: false, reason: 'no_content' });
    expect(validateChatDraft({ text: '   ' })).toEqual({ ok: false, reason: 'no_content' });
    expect(validateChatDraft(null)).toEqual({ ok: false, reason: 'no_content' });
  });
  it('rejects too-long text', () => {
    expect(validateChatDraft({ text: 'a'.repeat(CHAT_MAX_BODY_LEN + 1) }))
      .toEqual({ ok: false, reason: 'too_long' });
  });
});

describe('groupConsecutive', () => {
  it('groups runs from the same author', () => {
    const r = groupConsecutive([
      { from: 'a', text: '1' },
      { from: 'a', text: '2' },
      { from: 'b', text: '3' },
      { from: 'a', text: '4' },
    ]);
    expect(r).toHaveLength(3);
    expect(r[0].from).toBe('a');
    expect(r[0].items).toHaveLength(2);
    expect(r[1].from).toBe('b');
    expect(r[2].from).toBe('a');
  });

  it('empty input → []', () => {
    expect(groupConsecutive([])).toEqual([]);
    expect(groupConsecutive(null)).toEqual([]);
  });

  it('skips falsy entries', () => {
    const r = groupConsecutive([
      { from: 'a', text: '1' },
      null,
      { from: 'a', text: '2' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].items).toHaveLength(2);
  });
});

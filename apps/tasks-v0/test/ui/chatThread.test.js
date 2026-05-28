/**
 * chatThread unit tests — exercise the portable glue the web
 * chat.html page and the mobile ChatThreadScreen.jsx both consume.
 *
 * Slice #252 (2026-05-27). Mirrors composeArgs.test.js style.
 */

import { describe, it, expect } from 'vitest';
import {
  parseChatLocation,
  appealThreadId,
  taskIdFromAppealThread,
  normaliseChatMessages,
  pickRecipient,
  shouldUseAppeal,
  buildSendArgs,
  buildAppealArgs,
  shortWebid,
  formatTimestamp,
} from '../../src/ui/chatThread.js';

describe('chatThread.parseChatLocation', () => {
  it('parses URLSearchParams', () => {
    const p = new URLSearchParams('threadId=appeal:t-123&counterparty=https://id/a');
    expect(parseChatLocation(p)).toEqual({
      threadId:        'appeal:t-123',
      counterparty:    'https://id/a',
      appealForTaskId: null,
    });
  });
  it('parses plain objects', () => {
    expect(parseChatLocation({
      threadId:        'thr-1',
      appealForTaskId: 't-7',
    })).toEqual({
      threadId:        'thr-1',
      counterparty:    null,
      appealForTaskId: 't-7',
    });
  });
  it('returns null when threadId is missing', () => {
    expect(parseChatLocation(null)).toBeNull();
    expect(parseChatLocation(undefined)).toBeNull();
    expect(parseChatLocation({})).toBeNull();
    expect(parseChatLocation(new URLSearchParams(''))).toBeNull();
    expect(parseChatLocation({ counterparty: 'x' })).toBeNull();
  });
});

describe('chatThread.appealThreadId / taskIdFromAppealThread', () => {
  it('round-trips', () => {
    const tid = appealThreadId('t-42');
    expect(tid).toBe('appeal:t-42');
    expect(taskIdFromAppealThread(tid)).toBe('t-42');
  });
  it('returns null for non-appeal threads', () => {
    expect(taskIdFromAppealThread('chat:abc')).toBeNull();
    expect(taskIdFromAppealThread('some-other-thread')).toBeNull();
    expect(taskIdFromAppealThread(null)).toBeNull();
    expect(taskIdFromAppealThread(42)).toBeNull();
  });
  it('throws on bad taskId', () => {
    expect(() => appealThreadId('')).toThrow();
    expect(() => appealThreadId(null)).toThrow();
  });
});

describe('chatThread.normaliseChatMessages', () => {
  it('flattens substrate items into the view-model', () => {
    const raw = [
      {
        id: 'm1',
        text: 'hello',
        addedBy: 'webid://anne',
        addedAt: 100,
        source: { fromWebid: 'webid://anne', toWebid: 'webid://bob', sentAt: 100, threadId: 't' },
      },
      {
        id: 'm2',
        text: 'hi back',
        addedBy: 'webid://bob',
        addedAt: 200,
        source: { fromWebid: 'webid://bob', toWebid: 'webid://anne', sentAt: 200, threadId: 't' },
      },
    ];
    expect(normaliseChatMessages(raw)).toEqual([
      { id: 'm1', from: 'webid://anne', to: 'webid://bob',  ts: 100, body: 'hello' },
      { id: 'm2', from: 'webid://bob',  to: 'webid://anne', ts: 200, body: 'hi back' },
    ]);
  });
  it('falls back to addedBy / addedAt / body when source is missing', () => {
    const out = normaliseChatMessages([{ id: 'x', addedBy: 'A', addedAt: 5, body: 'hey' }]);
    expect(out).toEqual([{ id: 'x', from: 'A', to: null, ts: 5, body: 'hey' }]);
  });
  it('synthesises an id when none is present', () => {
    const out = normaliseChatMessages([
      { text: 'a', source: { sentAt: 1 } },
      { text: 'b' },
    ]);
    expect(out[0].id).toBe('1');
    expect(out[1].id).toBe('i1');   // index-based fallback
  });
  it('returns [] for non-arrays', () => {
    expect(normaliseChatMessages(null)).toEqual([]);
    expect(normaliseChatMessages(undefined)).toEqual([]);
    expect(normaliseChatMessages('nope')).toEqual([]);
  });
});

describe('chatThread.pickRecipient', () => {
  const me = 'webid://me';
  it('honours the explicit counterparty', () => {
    expect(pickRecipient([], { selfWebid: me, counterparty: 'webid://peer' }))
      .toBe('webid://peer');
  });
  it('picks the first not-self party off the thread', () => {
    const msgs = [
      { from: me,            to: 'webid://peer' },
      { from: 'webid://peer', to: me           },
    ];
    expect(pickRecipient(msgs, { selfWebid: me })).toBe('webid://peer');
  });
  it('returns null when the thread is all-self / empty', () => {
    expect(pickRecipient([], { selfWebid: me })).toBeNull();
    expect(pickRecipient([{ from: me, to: null }], { selfWebid: me })).toBeNull();
  });
  it('returns null on non-array', () => {
    expect(pickRecipient(null, { selfWebid: me })).toBeNull();
  });
});

describe('chatThread.shouldUseAppeal', () => {
  it('true on first message for an appeal-thread', () => {
    expect(shouldUseAppeal({ appealForTaskId: 't-1', messageCount: 0 })).toBe(true);
  });
  it('false once the thread has any messages', () => {
    expect(shouldUseAppeal({ appealForTaskId: 't-1', messageCount: 1 })).toBe(false);
  });
  it('false without an appealForTaskId', () => {
    expect(shouldUseAppeal({ appealForTaskId: null,  messageCount: 0 })).toBe(false);
    expect(shouldUseAppeal({ appealForTaskId: '',    messageCount: 0 })).toBe(false);
    expect(shouldUseAppeal({                       messageCount: 0 })).toBe(false);
  });
});

describe('chatThread.buildSendArgs', () => {
  it('builds a minimal payload', () => {
    expect(buildSendArgs({ threadId: 't', body: 'hi' }))
      .toEqual({ threadId: 't', body: 'hi' });
  });
  it('includes toWebid when recipient is set', () => {
    expect(buildSendArgs({ threadId: 't', recipient: 'webid://x', body: ' yo ' }))
      .toEqual({ threadId: 't', body: 'yo', toWebid: 'webid://x' });
  });
  it('trims the body', () => {
    expect(buildSendArgs({ threadId: 't', body: '   hello   ' }).body).toBe('hello');
  });
  it('throws when threadId or body is missing/blank', () => {
    expect(() => buildSendArgs({ body: 'x' })).toThrow(/threadId/);
    expect(() => buildSendArgs({ threadId: 't' })).toThrow(/body/);
    expect(() => buildSendArgs({ threadId: 't', body: '   ' })).toThrow(/body/);
  });
});

describe('chatThread.buildAppealArgs', () => {
  it('omits body when blank', () => {
    expect(buildAppealArgs({ taskId: 't-1' })).toEqual({ taskId: 't-1' });
    expect(buildAppealArgs({ taskId: 't-1', body: '   ' })).toEqual({ taskId: 't-1' });
  });
  it('includes a trimmed body when set', () => {
    expect(buildAppealArgs({ taskId: 't-1', body: '  opener  ' }))
      .toEqual({ taskId: 't-1', body: 'opener' });
  });
  it('throws on bad taskId', () => {
    expect(() => buildAppealArgs({})).toThrow(/taskId/);
    expect(() => buildAppealArgs({ taskId: '' })).toThrow(/taskId/);
  });
});

describe('chatThread.shortWebid', () => {
  it('strips path prefix + caps at 14 chars', () => {
    expect(shortWebid('https://id.example/anne')).toBe('anne');
    expect(shortWebid('did:key:abcdefghijklmnopqrstuvwxyz')).toBe('did:key:abcdef…');
  });
  it('returns "" for non-strings', () => {
    expect(shortWebid(null)).toBe('');
    expect(shortWebid(42)).toBe('');
  });
});

describe('chatThread.formatTimestamp', () => {
  it('formats epoch-ms as HH:mm', () => {
    // Use a Date instance to side-step the local-timezone dependency:
    // we render exactly what mobile renders.
    const d = new Date(2026, 4, 27, 9, 7);
    const out = formatTimestamp(d.getTime());
    expect(out).toBe('09:07');
  });
  it('returns "" for non-finite', () => {
    expect(formatTimestamp(NaN)).toBe('');
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp('nope')).toBe('');
  });
});

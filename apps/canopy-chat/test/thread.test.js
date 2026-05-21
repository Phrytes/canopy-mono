/**
 * canopy-chat — thread state tests.  v0.1 sub-slice 1.9.
 */
import { describe, it, expect } from 'vitest';

import { Thread, newThread } from '../src/thread.js';

const fixedNow = () => 1_700_000_000_000;

describe('Thread — basic API', () => {
  it('defaults to id "main" + name "Main"', () => {
    const t = new Thread();
    expect(t.id).toBe('main');
    expect(t.name).toBe('Main');
    expect(t.messages).toEqual([]);
  });

  it('accepts custom id / name / clock', () => {
    const t = new Thread({ id: 't-7', name: 'Test', now: fixedNow });
    expect(t.id).toBe('t-7');
    expect(t.name).toBe('Test');

    const m = t.addUserMessage('hello');
    expect(m.ts).toBe(1_700_000_000_000);
  });

  it('newThread() convenience matches the constructor', () => {
    const t = newThread({ id: 'x' });
    expect(t).toBeInstanceOf(Thread);
    expect(t.id).toBe('x');
  });
});

describe('Thread — appending messages', () => {
  it('appends user + shell messages in order', () => {
    const t = new Thread({ now: fixedNow });
    t.addUserMessage('/done dishwasher');
    t.addShellMessage(
      { kind: 'text', messageId: 'm-1', threadId: 'main',
        text: '✓ done', lifecycleState: 'live' },
    );
    expect(t.messages.length).toBe(2);
    expect(t.messages[0].origin).toBe('user');
    expect(t.messages[0].text).toBe('/done dishwasher');
    expect(t.messages[1].origin).toBe('shell');
    expect(t.messages[1].messageId).toBe('m-1');
    expect(t.messages[1].lifecycleState).toBe('live');
  });

  it('tail(n) returns last n messages', () => {
    const t = new Thread();
    for (let i = 0; i < 5; i++) t.addUserMessage(`msg-${i}`);
    expect(t.tail(2).map((m) => m.text)).toEqual(['msg-3', 'msg-4']);
    expect(t.tail().length).toBe(5);
  });
});

describe('Thread — A2 hybrid lifecycle on new user message', () => {
  it('flips live list-shape (action menu) → disabled', () => {
    const t = new Thread();
    t.addShellMessage({
      kind: 'list', messageId: 'm-1', threadId: 'main',
      lifecycleState: 'live',
      items: [{ id: 'c1', label: 'Dishwasher', buttons: [] }],
    }, { opId: 'listOpen' });

    t.addUserMessage('/done dishwasher');

    const stale = t.messages.find((m) => m.messageId === 'm-1');
    expect(stale.lifecycleState).toBe('disabled');
    expect(stale.rendered.lifecycleState).toBe('disabled');
  });

  it('does NOT flip text or error shapes', () => {
    const t = new Thread();
    t.addShellMessage({
      kind: 'text', messageId: 'm-a', threadId: null,
      text: 'hi', lifecycleState: 'live',
    });
    t.addShellMessage({
      kind: 'error', messageId: 'm-b', threadId: null,
      text: 'whoops', error: { code: 'x', message: 'whoops' },
      lifecycleState: 'live',
    });
    t.addUserMessage('next');

    expect(t.messages.find((m) => m.messageId === 'm-a').lifecycleState).toBe('live');
    expect(t.messages.find((m) => m.messageId === 'm-b').lifecycleState).toBe('live');
  });

  it('does NOT flip record / mini-page shapes (record panels stay live)', () => {
    const t = new Thread();
    t.addShellMessage({
      kind: 'record', messageId: 'm-r', threadId: null,
      lifecycleState: 'live',
    });
    t.addShellMessage({
      kind: 'mini-page', messageId: 'm-mp', threadId: null,
      lifecycleState: 'live',
    });
    t.addUserMessage('next');
    expect(t.messages.find((m) => m.messageId === 'm-r').lifecycleState).toBe('live');
    expect(t.messages.find((m) => m.messageId === 'm-mp').lifecycleState).toBe('live');
  });

  it('is idempotent — already-disabled stays disabled', () => {
    const t = new Thread();
    t.addShellMessage({
      kind: 'list', messageId: 'm-1', lifecycleState: 'live',
      items: [],
    });
    t.addUserMessage('first');
    t.addUserMessage('second');
    expect(t.messages.find((m) => m.messageId === 'm-1').lifecycleState).toBe('disabled');
  });

  it('flips multiple live action menus at once', () => {
    const t = new Thread();
    t.addShellMessage({ kind: 'list', messageId: 'm-1', lifecycleState: 'live', items: [] });
    t.addShellMessage({ kind: 'list', messageId: 'm-2', lifecycleState: 'live', items: [] });
    t.addUserMessage('next');
    expect(t.messages.find((m) => m.messageId === 'm-1').lifecycleState).toBe('disabled');
    expect(t.messages.find((m) => m.messageId === 'm-2').lifecycleState).toBe('disabled');
  });
});

describe('Thread — explicit close', () => {
  it('closeMessage flips a panel to "closed"', () => {
    const t = new Thread();
    t.addShellMessage({ kind: 'record', messageId: 'm-r', lifecycleState: 'live' });
    t.closeMessage('m-r');
    expect(t.messages[0].lifecycleState).toBe('closed');
    expect(t.messages[0].rendered.lifecycleState).toBe('closed');
  });

  it('is silent for unknown messageId', () => {
    const t = new Thread();
    expect(() => t.closeMessage('nope')).not.toThrow();
  });
});

describe('Thread — listing cache + fuzzy resolution', () => {
  const chores = [
    { id: 'chore-1', label: 'Dishwasher' },
    { id: 'chore-2', label: 'Bins out' },
    { id: 'chore-3', label: 'Vacuum living room' },
  ];

  function seed(t) {
    t.addShellMessage({
      kind: 'list', messageId: 'm-1', lifecycleState: 'live',
      items: chores.map((c) => ({ ...c, buttons: [] })),
    }, { opId: 'listOpen' });
  }

  it('caches the most recent list-shape reply', () => {
    const t = new Thread();
    seed(t);
    const cached = t.lastListingFor('listOpen');
    expect(cached.items).toEqual([
      { id: 'chore-1', label: 'Dishwasher' },
      { id: 'chore-2', label: 'Bins out' },
      { id: 'chore-3', label: 'Vacuum living room' },
    ]);
  });

  it('returns undefined when no listing cached for that opId', () => {
    const t = new Thread();
    expect(t.lastListingFor('nope')).toBeUndefined();
  });

  it('does NOT cache when meta.opId is missing', () => {
    const t = new Thread();
    t.addShellMessage({
      kind: 'list', messageId: 'm-1', lifecycleState: 'live',
      items: chores.map((c) => ({ ...c, buttons: [] })),
    }); // no meta.opId
    expect(t.lastListingFor('listOpen')).toBeUndefined();
  });

  it('exact id match wins', () => {
    const t = new Thread();
    seed(t);
    expect(t.resolveFuzzy('listOpen', 'chore-2')).toBe('chore-2');
  });

  it('exact label match (case-insensitive) wins', () => {
    const t = new Thread();
    seed(t);
    expect(t.resolveFuzzy('listOpen', 'dishwasher')).toBe('chore-1');
    expect(t.resolveFuzzy('listOpen', 'DISHWASHER')).toBe('chore-1');
    expect(t.resolveFuzzy('listOpen', '  bins out  ')).toBe('chore-2');
  });

  it('unique substring match (case-insensitive)', () => {
    const t = new Thread();
    seed(t);
    expect(t.resolveFuzzy('listOpen', 'vacuum')).toBe('chore-3');
    expect(t.resolveFuzzy('listOpen', 'living')).toBe('chore-3');
  });

  it("returns null for ambiguous substring", () => {
    const t = new Thread();
    seed(t);
    // 'r' appears in 'Dishwasher' AND 'living room' AND 'Vacuum living room'
    expect(t.resolveFuzzy('listOpen', 'r')).toBeNull();
  });

  it("returns null for no match", () => {
    const t = new Thread();
    seed(t);
    expect(t.resolveFuzzy('listOpen', 'gardening')).toBeNull();
  });

  it("returns null when no listing exists", () => {
    const t = new Thread();
    expect(t.resolveFuzzy('listOpen', 'anything')).toBeNull();
  });

  it("returns null for empty / non-string token", () => {
    const t = new Thread();
    seed(t);
    expect(t.resolveFuzzy('listOpen', '')).toBeNull();
    expect(t.resolveFuzzy('listOpen', '   ')).toBeNull();
    expect(t.resolveFuzzy('listOpen', null)).toBeNull();
  });

  it('caches the LATEST listing when called twice', () => {
    const t = new Thread();
    seed(t);
    // Now a different listing comes in.
    t.addShellMessage({
      kind: 'list', messageId: 'm-2', lifecycleState: 'live',
      items: [{ id: 'chore-99', label: 'Defrost freezer', buttons: [] }],
    }, { opId: 'listOpen' });

    expect(t.resolveFuzzy('listOpen', 'dishwasher')).toBeNull();  // gone
    expect(t.resolveFuzzy('listOpen', 'defrost')).toBe('chore-99');
  });
});

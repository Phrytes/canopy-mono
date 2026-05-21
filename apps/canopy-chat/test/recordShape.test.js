/**
 * canopy-chat — record + mini-page shape tests.  v0.3 sub-slices 3.1 + 3.2.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { renderReply, __resetMessageIdSeq } from '../src/renderer.js';

beforeEach(() => __resetMessageIdSeq());

describe('renderReply — record shape', () => {
  it("extracts fields, infers title, sets kind:'record'", () => {
    const r = renderReply({
      payload: {
        title:       'Household',
        memberCount: 3,
        polite:      true,
      },
      shape: 'record', threadId: 't-1',
    });
    expect(r.kind).toBe('record');
    expect(r.title).toBe('Household');
    expect(r.lifecycleState).toBe('live');
    expect(r.fields).toEqual([
      { name: 'memberCount', value: 3,    kind: 'number'  },
      { name: 'polite',      value: true, kind: 'boolean' },
    ]);
    expect(r.payload).toEqual({ title: 'Household', memberCount: 3, polite: true });
  });

  it("falls back to .name then .label for title", () => {
    expect(renderReply({ payload: { name: 'X' }, shape: 'record' }).title).toBe('X');
    expect(renderReply({ payload: { label: 'Y' }, shape: 'record' }).title).toBe('Y');
    expect(renderReply({ payload: { foo: 1 }, shape: 'record' }).title).toBeUndefined();
  });

  it("skips meta + underscore-prefixed fields", () => {
    const r = renderReply({
      payload: {
        title: 'X', id: 'item-1',
        _sync: { peers: 3 },
        _lastSync: 12_345,
        name: 'should be skipped (used for title)',
        good: 'visible',
      },
      shape: 'record',
    });
    expect(r.fields.map((f) => f.name)).toEqual(['good']);
  });

  it("handles primitive / null / undefined payloads gracefully", () => {
    expect(renderReply({ payload: null,      shape: 'record' }).fields).toEqual([]);
    expect(renderReply({ payload: undefined, shape: 'record' }).fields).toEqual([]);
    expect(renderReply({ payload: 'string',  shape: 'record' }).fields).toEqual([]);
    expect(renderReply({ payload: [1,2,3],   shape: 'record' }).fields).toEqual([]);
  });

  it("classifies field kinds", () => {
    const r = renderReply({
      payload: {
        s:   'hi',
        n:   42,
        b:   true,
        arr: [1, 2],
        obj: { foo: 1 },
        u:   undefined,
      },
      shape: 'record',
    });
    const byName = Object.fromEntries(r.fields.map((f) => [f.name, f.kind]));
    expect(byName.s).toBe('string');
    expect(byName.n).toBe('number');
    expect(byName.b).toBe('boolean');
    expect(byName.arr).toBe('list');
    expect(byName.obj).toBe('object');
    // `u` (undefined) goes to 'unknown'
    expect(byName.u).toBe('unknown');
  });
});

describe('renderReply — mini-page shape (same data, different kind)', () => {
  it("emits kind:'mini-page'", () => {
    const r = renderReply({ payload: { foo: 'bar' }, shape: 'mini-page' });
    expect(r.kind).toBe('mini-page');
    expect(r.fields).toEqual([{ name: 'foo', value: 'bar', kind: 'string' }]);
  });
});

describe('Thread A2 hybrid — record/mini-page stay live (existing behaviour, verified)', () => {
  // Pulled in from thread.test.js to nail down that adding the new
  // shapes doesn't regress the lifecycle rules.
  it("record + mini-page do NOT flip 'live' → 'disabled' on next user msg", async () => {
    const { Thread } = await import('../src/thread.js');
    const t = new Thread();
    t.addShellMessage({
      kind: 'record', messageId: 'm-r', lifecycleState: 'live', fields: [],
    });
    t.addShellMessage({
      kind: 'mini-page', messageId: 'm-mp', lifecycleState: 'live', fields: [],
    });
    t.addUserMessage('next');
    expect(t.messages.find((m) => m.messageId === 'm-r').lifecycleState).toBe('live');
    expect(t.messages.find((m) => m.messageId === 'm-mp').lifecycleState).toBe('live');
  });

  it("closeMessage flips a record/mini-page to 'closed'", async () => {
    const { Thread } = await import('../src/thread.js');
    const t = new Thread();
    t.addShellMessage({
      kind: 'record', messageId: 'm-r', lifecycleState: 'live', fields: [],
    });
    t.closeMessage('m-r');
    expect(t.messages[0].lifecycleState).toBe('closed');
  });
});

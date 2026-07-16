/**
 * basis — renderer tests.  v0.1 sub-slice 1.8.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { renderReply, formatText, __resetMessageIdSeq } from '../src/renderer.js';

beforeEach(() => __resetMessageIdSeq());

describe('renderReply — text shape', () => {
  it('renders payload.message', () => {
    const r = renderReply({
      payload: { message: '✓ Dishwasher complete.', ok: true },
      shape: 'text', threadId: 't-1',
    });
    expect(r.kind).toBe('text');
    expect(r.text).toBe('✓ Dishwasher complete.');
    expect(r.threadId).toBe('t-1');
    expect(r.lifecycleState).toBe('live');
    expect(r.messageId).toMatch(/^m-/);
  });

  it("uses payload.text when no .message", () => {
    const r = renderReply({ payload: { text: 'hello' }, shape: 'text' });
    expect(r.text).toBe('hello');
  });

  it('renders ok:true as ✓ when no message', () => {
    const r = renderReply({ payload: { ok: true }, shape: 'text' });
    expect(r.text).toBe('✓');
  });

  it("renders ok:false with payload.error", () => {
    const r = renderReply({
      payload: { ok: false, error: 'pod offline' }, shape: 'text',
    });
    expect(r.text).toBe('pod offline');
  });

  it("renders ok:false with no error → 'Failed'", () => {
    const r = renderReply({ payload: { ok: false }, shape: 'text' });
    expect(r.text).toBe('Failed');
  });

  it("renders primitive string payload verbatim", () => {
    const r = renderReply({ payload: 'hello world', shape: 'text' });
    expect(r.text).toBe('hello world');
  });

  it("renders primitive number / boolean", () => {
    expect(renderReply({ payload: 42, shape: 'text' }).text).toBe('42');
    expect(renderReply({ payload: true, shape: 'text' }).text).toBe('true');
  });

  it("falls back to JSON.stringify for opaque object payloads", () => {
    const r = renderReply({ payload: { unknownField: 'x' }, shape: 'text' });
    expect(r.text).toBe('{"unknownField":"x"}');
  });

  it("renders empty string for null / undefined payload", () => {
    expect(renderReply({ payload: null,      shape: 'text' }).text).toBe('');
    expect(renderReply({ payload: undefined, shape: 'text' }).text).toBe('');
  });

  it("defaults to text shape when reply.shape is absent", () => {
    const r = renderReply({ payload: 'no-shape', threadId: 't-7' });
    expect(r.kind).toBe('text');
    expect(r.text).toBe('no-shape');
    expect(r.threadId).toBe('t-7');
  });
});

describe('renderReply — error shape', () => {
  it('renders Reply.error as kind:error with text + error fields', () => {
    const r = renderReply({
      payload: null,
      shape: 'text',
      threadId: 't-3',
      error: { code: 'unauthorised', message: 'no access' },
    });
    expect(r.kind).toBe('error');
    expect(r.text).toBe('no access');
    expect(r.error).toEqual({ code: 'unauthorised', message: 'no access' });
    expect(r.threadId).toBe('t-3');
  });

  it("falls back to code when message empty", () => {
    const r = renderReply({
      payload: null, shape: 'text',
      error: { code: 'rate-limit', message: '' },
    });
    expect(r.text).toBe('rate-limit');
  });

  it("falls back to 'Error' when both empty", () => {
    const r = renderReply({
      payload: null, shape: 'text',
      error: { code: '', message: '' },
    });
    expect(r.text).toBe('Error');
  });
});

describe('renderReply — list shape', () => {
  it('renders payload.items into normalised list items', () => {
    const r = renderReply({
      payload: {
        items: [
          { id: 'chore-1', label: 'Dishwasher' },
          { id: 'chore-2', label: 'Bins out' },
        ],
      },
      shape: 'list',
      threadId: 't-1',
    });
    expect(r.kind).toBe('list');
    expect(r.lifecycleState).toBe('live');     // A2 hybrid default
    expect(r.items).toEqual([
      { id: 'chore-1', label: 'Dishwasher', buttons: [] },
      { id: 'chore-2', label: 'Bins out',   buttons: [] },
    ]);
  });

  it('passes through icon + kind for agent rows', () => {
    const r = renderReply({
      payload: { items: [
        { id: 'fp-bot', label: 'Feedback assistant', kind: 'agent', icon: '🤖' },
        { id: 'c-2', label: 'Plain' },
      ] },
      shape: 'list',
    });
    expect(r.items[0].icon).toBe('🤖');
    expect(r.items[0].kind).toBe('agent');
    expect(r.items[1].icon).toBeUndefined();   // plain rows unchanged
    expect(r.items[1].kind).toBeUndefined();
  });

  it("honours an item's own buttons (agent contact) when no manifest keyboard", () => {
    const r = renderReply({
      payload: { items: [
        { id: 'fp-bot', label: 'Feedback assistant', kind: 'agent',
          buttons: [{ label: 'Open chat', callbackData: 'openFeedback:fp-bot' }] },
      ] },
      shape: 'list',
    });   // no manifestsByOrigin → without the fix, buttons would be []
    expect(r.items[0].buttons).toEqual([{ label: 'Open chat', callbackData: 'openFeedback:fp-bot' }]);
  });

  it('accepts a bare array as payload (tolerant)', () => {
    const r = renderReply({
      payload: [{ id: 'a', name: 'Anne' }, { id: 'b', name: 'Bob' }],
      shape: 'list',
    });
    expect(r.items.length).toBe(2);
    expect(r.items[0].label).toBe('Anne');
    expect(r.items[1].label).toBe('Bob');
  });

  it("walks label-field priority: label > title > text > name > description", () => {
    const r = renderReply({
      payload: { items: [
        { id: '1', label: 'L', title: 'T' },        // label wins
        { id: '2', title: 'T', text: 'X' },         // title wins
        { id: '3', text: 'X', name: 'N' },          // text wins
        { id: '4', name: 'N', description: 'D' },   // name wins
        { id: '5', description: 'D' },              // description wins
        { id: '6' },                                 // fallback to id
      ] },
      shape: 'list',
    });
    expect(r.items.map((i) => i.label)).toEqual(['L', 'T', 'X', 'N', 'D', '6']);
  });

  it('generates default id when item has none', () => {
    const r = renderReply({
      payload: { items: [{ label: 'no id' }, { label: 'also' }] },
      shape: 'list',
    });
    expect(r.items[0].id).toBe('i-0');
    expect(r.items[1].id).toBe('i-1');
  });

  it('renders empty list when payload has no items', () => {
    const r = renderReply({ payload: {}, shape: 'list' });
    expect(r.items).toEqual([]);
  });

  it('attaches inline keyboard from manifest when manifestsByOrigin provided', () => {
    const householdManifest = {
      app: 'household', itemTypes: ['chore'],
      operations: [{
        id: 'markComplete', verb: 'complete',
        appliesTo: { type: 'chore', state: 'open' },
        params: [],
        surfaces: { ui: { control: 'button', label: 'Mark done' } },
      }],
      views: [{ id: 'chores', title: 'C', type: 'chore' }],
    };
    const r = renderReply({
      payload: {
        items: [
          { id: 'c1', label: 'Dishwasher', type: 'chore', state: 'open' },
          { id: 'c2', label: 'Bins',       type: 'chore', state: 'done' },
        ],
      },
      shape: 'list',
    }, {
      appOrigin: 'household',
      manifestsByOrigin: { household: householdManifest },
    });
    // c1 (open) matches appliesTo → has the button.
    expect(r.items[0].buttons).toEqual([
      { label: 'Mark done', callbackData: 'markComplete:c1' },
    ]);
    // c2 (done) — no match.
    expect(r.items[1].buttons).toEqual([]);
  });
});

describe('renderReply — input validation', () => {
  it('throws on null / undefined reply', () => {
    expect(() => renderReply(null)).toThrow(/reply required/);
    expect(() => renderReply(undefined)).toThrow();
  });
});

describe('formatText — exported convention helper', () => {
  it('exposes the same priority order as renderReply text shape', () => {
    expect(formatText({ message: 'A', text: 'B' })).toBe('A');
    expect(formatText({ text: 'B', ok: true })).toBe('B');
    expect(formatText({ ok: true })).toBe('✓');
    expect(formatText({ ok: false, error: 'X' })).toBe('X');
    expect(formatText({ ok: false })).toBe('Failed');
    expect(formatText('raw')).toBe('raw');
    expect(formatText(null)).toBe('');
  });
});

describe('renderReply — messageId uniqueness', () => {
  it('each call gets a unique messageId', () => {
    const a = renderReply({ payload: 'a', shape: 'text' }).messageId;
    const b = renderReply({ payload: 'b', shape: 'text' }).messageId;
    const c = renderReply({ payload: 'c', shape: 'text' }).messageId;
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('renderReply — notification shape (E1)', () => {
  it('carries title + body + a valid severity level', () => {
    const r = renderReply({ shape: 'notification', payload: { title: 'Heads up', body: 'Anne joined', level: 'success' } });
    expect(r.kind).toBe('notification');
    expect(r.title).toBe('Heads up');
    expect(r.text).toBe('Anne joined');
    expect(r.level).toBe('success');
    expect(r.lifecycleState).toBe('live');
  });

  it('defaults an unknown/absent level to "info" and reads text aliases', () => {
    expect(renderReply({ shape: 'notification', payload: { text: 'x', level: 'bogus' } }).level).toBe('info');
    expect(renderReply({ shape: 'notification', payload: { message: 'via message' } }).text).toBe('via message');
    expect(renderReply({ shape: 'notification', payload: {} }).level).toBe('info');
  });
});

describe('renderReply — file shape (E1)', () => {
  it('maps name/mime/size/url/description with aliases', () => {
    const r = renderReply({ shape: 'file', payload: {
      filename: 'plan.pdf', contentType: 'application/pdf', size: 20480,
      href: 'https://pod/plan.pdf', caption: 'Q1 plan',
    } });
    expect(r.kind).toBe('file');
    expect(r).toMatchObject({
      name: 'plan.pdf', mime: 'application/pdf', size: 20480,
      url: 'https://pod/plan.pdf', description: 'Q1 plan', lifecycleState: 'live',
    });
  });

  it('tolerates a bare/empty payload', () => {
    const r = renderReply({ shape: 'file', payload: {} });
    expect(r.kind).toBe('file');
    expect(r.name).toBe('');
    expect(r.size).toBeUndefined();
    expect(r.url).toBeUndefined();
  });
});

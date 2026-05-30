/**
 * P6.M3 — Stream per-row actions + pinned compose tests.
 */
import { describe, it, expect } from 'vitest';
import {
  actionsForStreamRow, buildStreamComposeContext,
} from '../../src/v2/streamActions.js';

describe('actionsForStreamRow', () => {
  function mkRow({ id = 'r1', circleId = 'selwerd', kind, type, payload = {} } = {}) {
    return {
      id, circleId,
      type, event: { type, payload: { kind, ...payload } },
    };
  }

  it('returns [] for malformed rows', () => {
    expect(actionsForStreamRow(null)).toEqual([]);
    expect(actionsForStreamRow({})).toEqual([]);
    expect(actionsForStreamRow({ event: 'not-an-object' })).toEqual([]);
  });

  it('returns [] for unknown kinds (renderer falls back to no buttons)', () => {
    const row = mkRow({ kind: 'mystery' });
    expect(actionsForStreamRow(row)).toEqual([]);
  });

  it('emits help + ignore for a question/vraag', () => {
    const row = mkRow({ kind: 'question' });
    const actions = actionsForStreamRow(row);
    expect(actions.map((a) => a.action)).toEqual(['help', 'ignore']);
    expect(actions[0].label).toBe('circle.streamAction.help');
  });

  it('emits offer + ignore for borrow/leen', () => {
    expect(actionsForStreamRow(mkRow({ kind: 'borrow' })).map((a) => a.action))
      .toEqual(['offer', 'ignore']);
    expect(actionsForStreamRow(mkRow({ kind: 'leen' })).map((a) => a.action))
      .toEqual(['offer', 'ignore']);
  });

  it('emits take + ignore for aanbod', () => {
    expect(actionsForStreamRow(mkRow({ kind: 'aanbod' })).map((a) => a.action))
      .toEqual(['take', 'ignore']);
  });

  it('emits claim + snooze for a chore', () => {
    expect(actionsForStreamRow(mkRow({ kind: 'chore' })).map((a) => a.action))
      .toEqual(['claim', 'snooze']);
  });

  it('emits done + snooze for a reminder', () => {
    expect(actionsForStreamRow(mkRow({ kind: 'reminder' })).map((a) => a.action))
      .toEqual(['done', 'snooze']);
  });

  it('reads kind from event.type when payload.kind is absent', () => {
    const row = mkRow({ type: 'question', payload: { kind: undefined } });
    expect(actionsForStreamRow(row).map((a) => a.action)).toEqual(['help', 'ignore']);
  });

  it('normalises case (KIND, Kind, kind)', () => {
    expect(actionsForStreamRow(mkRow({ kind: 'QUESTION' })).map((a) => a.action))
      .toEqual(['help', 'ignore']);
  });

  it('threads rowId + circleId + kind through the payload', () => {
    const row = mkRow({ id: 'r-42', circleId: 'huisgenoten', kind: 'chore' });
    const actions = actionsForStreamRow(row);
    expect(actions[0].payload).toEqual({
      rowId: 'r-42', circleId: 'huisgenoten', kind: 'chore', ref: null,
    });
    expect(actions[0].id).toBe('r-42-claim');
  });

  it('passes through a payload.ref when present (e.g. itemRef)', () => {
    const row = mkRow({ kind: 'question', payload: { ref: 'item-99' } });
    expect(actionsForStreamRow(row)[0].payload.ref).toBe('item-99');
  });
});

describe('buildStreamComposeContext', () => {
  const t = (key, vars = {}) => {
    if (key === 'circle.stream.compose_placeholder_targeted') return `Reply in ${vars.circle}`;
    if (key === 'circle.stream.compose_placeholder_default')  return `Reply in the timeline`;
    return key;
  };

  it('returns the default placeholder when no row is focused', () => {
    const ctx = buildStreamComposeContext({ focusedRow: null, t });
    expect(ctx).toEqual({
      targetCircleId: null, targetCircleName: null,
      placeholder: 'Reply in the timeline', replyToId: null,
    });
  });

  it('returns the targeted placeholder + threads circleId/replyToId when focused', () => {
    const row = { id: 'r-1', circleId: 'selwerd', circleName: 'Selwerd' };
    const ctx = buildStreamComposeContext({ focusedRow: row, t });
    expect(ctx).toEqual({
      targetCircleId: 'selwerd', targetCircleName: 'Selwerd',
      placeholder: 'Reply in Selwerd', replyToId: 'r-1',
    });
  });

  it('falls back to the default placeholder when circleName is absent', () => {
    const ctx = buildStreamComposeContext({ focusedRow: { id: 'x', circleId: 'c' }, t });
    expect(ctx.placeholder).toBe('Reply in the timeline');
  });

  it('uses key identity without a translator', () => {
    const ctx = buildStreamComposeContext({ focusedRow: null });
    expect(ctx.placeholder).toBe('circle.stream.compose_placeholder_default');
  });
});

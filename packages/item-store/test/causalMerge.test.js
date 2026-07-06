/**
 * causalMerge (Objective L) — origin-timestamp + writer-id causal LWW comparator.
 * The pure decision behind inbound ingest: a causally-OLDER inbound never clobbers a newer local edit; a
 * causally-newer inbound wins; true concurrency resolves by a deterministic writer-id tiebreak; a payload
 * without origin metadata falls back to last-received-wins (backward-compat).
 */
import { describe, it, expect } from 'vitest';
import { causalWinner, causalRank } from '../src/causalMerge.js';

const at = (updatedAt, updatedBy = 'w') => ({ id: 'X', type: 'task', updatedAt, updatedBy });

describe('causalRank', () => {
  it('parses ISO strings and epoch numbers; NaN when absent/unparseable', () => {
    expect(causalRank({ updatedAt: '2026-01-01T00:00:00.000Z' }).at).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(causalRank({ updatedAt: 1700 }).at).toBe(1700);
    expect(Number.isNaN(causalRank({}).at)).toBe(true);
    expect(Number.isNaN(causalRank({ updatedAt: 'not-a-date' }).at)).toBe(true);
    expect(causalRank(null).at).toBeNaN();
    expect(causalRank({ updatedBy: 'alice' }).by).toBe('alice');
  });
});

describe('causalWinner', () => {
  it('no local → incoming (create)', () => {
    expect(causalWinner(null, at('2026-01-01T00:00:00Z'))).toBe('incoming');
  });

  it('newer inbound wins; OLDER inbound does NOT clobber', () => {
    const local = at('2026-05-01T00:00:00Z');
    expect(causalWinner(local, at('2026-05-02T00:00:00Z'))).toBe('incoming'); // newer
    expect(causalWinner(local, at('2026-04-30T00:00:00Z'))).toBe('local');    // older → keep local
  });

  it('works with epoch-number clocks too', () => {
    expect(causalWinner(at(2000), at(3000))).toBe('incoming');
    expect(causalWinner(at(3000), at(2000))).toBe('local');
  });

  it('concurrent (equal clock) → deterministic writer-id tiebreak, symmetric', () => {
    const a = at('2026-05-01T00:00:00Z', 'alice');
    const b = at('2026-05-01T00:00:00Z', 'bob');
    // bob > alice, so bob always wins whichever side it is on
    expect(causalWinner(a, b)).toBe('incoming'); // local=alice, incoming=bob → bob
    expect(causalWinner(b, a)).toBe('local');    // local=bob,   incoming=alice → bob
  });

  it('fully identical (same clock + writer) → local (idempotent no-op)', () => {
    const x = at('2026-05-01T00:00:00Z', 'alice');
    expect(causalWinner(x, { ...x })).toBe('local');
  });

  it('BACKWARD-COMPAT: incoming without a clock → last-received-wins (incoming)', () => {
    expect(causalWinner(at('2026-05-01T00:00:00Z'), { id: 'X', type: 'task' })).toBe('incoming');
  });

  it('local without a clock but incoming has one → incoming', () => {
    expect(causalWinner({ id: 'X', type: 'task' }, at('2000-01-01T00:00:00Z'))).toBe('incoming');
  });
});

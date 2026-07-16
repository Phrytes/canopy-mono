/**
 * kringMemory — recent kring turns as interpret context (conversation memory).
 */
import { describe, it, expect } from 'vitest';
import { recentKringTurns } from '../src/v2/kringMemory.js';

const row = (ts, actor, text) => ({ id: `r${ts}`, ts, actor, event: { payload: { kind: 'chat-message', text } } });

describe('recentKringTurns', () => {
  it('formats turns as you:/assistant:, chronological, capped to the limit', () => {
    const rows = [
      row(3, 'bot', 'Added milk'),
      row(1, 'me', 'add milk'),
      row(4, 'me', 'and bread'),
      row(2, 'bot', 'ok'),
    ];
    expect(recentKringTurns({ rows, limit: 3 })).toEqual([
      'assistant: ok',
      'assistant: Added milk',
      'you: and bread',
    ]);
  });

  it('skips non-chat rows + empty text', () => {
    const rows = [
      row(1, 'me', '  '),
      { id: 'x', ts: 2, actor: 'me', event: { payload: { kind: 'buurt-post', text: 'a post' } } },
      row(3, 'bot', 'real reply'),
    ];
    expect(recentKringTurns({ rows })).toEqual(['assistant: real reply']);
  });

  it('returns [] for no/garbage rows', () => {
    expect(recentKringTurns()).toEqual([]);
    expect(recentKringTurns({ rows: null })).toEqual([]);
  });
});

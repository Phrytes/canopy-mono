// Reveal ladder (#5b) — anonymous-talk-first. Each side controls only their OWN level; self-reveal is
// unilateral + upward-only; ephemeral is the default, a preference can start at persona, and either
// side can quick-switch up. You never reveal the OTHER; the matched driver is never on this ladder.
import { describe, it, expect } from 'vitest';
import {
  REVEAL_LEVELS, isRevealLevel, revealRank, nextRevealLevel, ephemeralHandle,
  createParticipant, revealSelf, revealNext, presentSelf,
} from '../index.js';

describe('reveal ladder (#5b)', () => {
  it('levels are ordered least→most revealing', () => {
    expect(REVEAL_LEVELS).toEqual(['ephemeral', 'persona', 'identity']);
    expect(revealRank('ephemeral')).toBe(0);
    expect(revealRank('identity')).toBe(2);
    expect(revealRank('nonsense')).toBe(-1);
    expect(isRevealLevel('persona')).toBe(true);
    expect(nextRevealLevel('ephemeral')).toBe('persona');
    expect(nextRevealLevel('identity')).toBe('identity');   // caps at the top
  });

  it('ephemeralHandle is deterministic per (talk, side), and differs across talks + sides', () => {
    expect(ephemeralHandle('talk-1', 'a')).toBe(ephemeralHandle('talk-1', 'a'));   // stable
    expect(ephemeralHandle('talk-1', 'a')).not.toBe(ephemeralHandle('talk-1', 'b')); // two sides differ
    expect(ephemeralHandle('talk-1', 'a')).not.toBe(ephemeralHandle('talk-2', 'a')); // unlinkable across talks
    expect(ephemeralHandle('talk-1', 'a')).toMatch(/^[a-z]+-[a-z]+$/);               // friendly label, no PII
  });

  it('default participant starts ephemeral; a preference can start at persona', () => {
    expect(createParticipant({ talkId: 't', side: 'a' }).level).toBe('ephemeral');
    expect(createParticipant({ talkId: 't', side: 'a', startLevel: 'persona', persona: { id: 'p' } }).level).toBe('persona');
    expect(createParticipant({ talkId: 't', startLevel: 'garbage' }).level).toBe('ephemeral');   // unknown → safe default
  });

  it('revealSelf is unilateral + upward-only (never un-reveals, never reveals the other)', () => {
    const p0 = createParticipant({ talkId: 't', side: 'a', persona: { id: 'anne', name: 'Anne' } });
    const p1 = revealSelf(p0, 'persona');
    expect(p1.level).toBe('persona');
    expect(p0.level).toBe('ephemeral');                 // immutable — new state returned
    expect(revealSelf(p1, 'ephemeral')).toBe(p1);       // downward request is a no-op
    expect(revealSelf(p1, 'persona')).toBe(p1);         // equal request is a no-op
    expect(revealSelf(p1, 'bogus')).toBe(p1);           // unknown → no-op
  });

  it('revealNext = the quick-switch-up-one-rung tap', () => {
    let p = createParticipant({ talkId: 't', side: 'a', persona: { id: 'anne' } });
    p = revealNext(p); expect(p.level).toBe('persona');
    p = revealNext(p); expect(p.level).toBe('identity');
    p = revealNext(p); expect(p.level).toBe('identity');   // caps
  });

  it('presentSelf projects ONLY the chosen level to the other side', () => {
    const eph = createParticipant({ talkId: 'talk-9', side: 'a', persona: { id: 'anne', name: 'Anne' } });
    // ephemeral → just the handle, NO persona leaks
    expect(presentSelf(eph)).toEqual({ level: 'ephemeral', handle: ephemeralHandle('talk-9', 'a') });

    const pers = revealSelf(eph, 'persona');
    expect(presentSelf(pers)).toEqual({ level: 'persona', persona: { id: 'anne', name: 'Anne' } });

    const idv = revealSelf(pers, 'identity');
    expect(presentSelf(idv)).toEqual({ level: 'identity', identityOpen: true, persona: { id: 'anne', name: 'Anne' } });
  });

  it('a persona reveal with no persona set surfaces null (no crash, nothing fabricated)', () => {
    const p = revealSelf(createParticipant({ talkId: 't', side: 'a' }), 'persona');
    expect(presentSelf(p)).toEqual({ level: 'persona', persona: null });
  });
});

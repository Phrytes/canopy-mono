/**
 * auto-hop-prompt tests.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldAutoSuggestHop, buildHopPromptCard,
  rememberDismissed, hasDismissed, MAX_HOPS,
} from '../src/hopPrompt.js';

describe('shouldAutoSuggestHop', () => {
  it('prompts when there are no in-circle matches + at least one eligible contact + hop is on', () => {
    expect(shouldAutoSuggestHop({
      inCircleMatchCount: 0, hopEligibleContactsCount: 1, hopGloballyOn: true,
    })).toEqual({ prompt: true, reason: null });
  });

  it('does NOT prompt when in-circle has matches', () => {
    expect(shouldAutoSuggestHop({
      inCircleMatchCount: 1, hopEligibleContactsCount: 3, hopGloballyOn: true,
    })).toEqual({ prompt: false, reason: 'have-matches' });
  });

  it('does NOT prompt when the user has no relay-eligible contacts', () => {
    expect(shouldAutoSuggestHop({
      inCircleMatchCount: 0, hopEligibleContactsCount: 0, hopGloballyOn: true,
    })).toEqual({ prompt: false, reason: 'no-eligible-contacts' });
  });

  it('does NOT prompt when global hop stance is off', () => {
    expect(shouldAutoSuggestHop({
      inCircleMatchCount: 0, hopEligibleContactsCount: 2, hopGloballyOn: false,
    })).toEqual({ prompt: false, reason: 'hop-off' });
  });

  it('does NOT prompt when the user already dismissed this skill in-session', () => {
    expect(shouldAutoSuggestHop({
      inCircleMatchCount: 0, hopEligibleContactsCount: 2, hopGloballyOn: true,
      dismissedForSkill: true,
    })).toEqual({ prompt: false, reason: 'dismissed' });
  });

  it('takes safe defaults when called with no args (no prompt)', () => {
    expect(shouldAutoSuggestHop()).toEqual({ prompt: false, reason: 'no-eligible-contacts' });
  });

  it('uses the same predicate even when match count is omitted (treated as 0)', () => {
    expect(shouldAutoSuggestHop({
      hopEligibleContactsCount: 1, hopGloballyOn: true,
    })).toEqual({ prompt: true, reason: null });
  });
});

describe('buildHopPromptCard', () => {
  const t = (key, vars = {}) => {
    if (key === 'circle.hopPrompt.title')     return "Try further?";
    if (key === 'circle.hopPrompt.body')      return `No match for "${vars.skill}" in your circles. Search via ${vars.count} contact(s)?`;
    if (key === 'circle.hopPrompt.body_anon') return `No matches in your circles. Search via ${vars.count} contact(s)?`;
    if (key === 'circle.hopPrompt.accept')    return 'Yes, one step further';
    if (key === 'circle.hopPrompt.dismiss')   return 'Skip';
    return key;
  };

  it('produces a structured card with named accept/dismiss actions', () => {
    const card = buildHopPromptCard({ skillQuery: 'badkamers', hopEligibleContactsCount: 3, t });
    expect(card.title).toBe('Try further?');
    expect(card.body).toBe('No match for "badkamers" in your circles. Search via 3 contact(s)?');
    expect(card.accept).toEqual({ label: 'Yes, one step further', action: 'hop-relay' });
    expect(card.dismiss).toEqual({ label: 'Skip', action: 'skip-hop' });
    expect(card.id).toMatch(/^hop-prompt-/);
    expect(card.skillQuery).toBe('badkamers');
  });

  it('uses the anon body when skillQuery is empty/whitespace', () => {
    const card = buildHopPromptCard({ skillQuery: '   ', hopEligibleContactsCount: 1, t });
    expect(card.body).toBe('No matches in your circles. Search via 1 contact(s)?');
    expect(card.skillQuery).toBe('');
  });

  it('trims the skillQuery before storing', () => {
    const card = buildHopPromptCard({ skillQuery: '  badkamers  ', hopEligibleContactsCount: 1, t });
    expect(card.skillQuery).toBe('badkamers');
  });

  it('falls back to key identity when no translator is supplied', () => {
    const card = buildHopPromptCard({ skillQuery: 'q', hopEligibleContactsCount: 1 });
    expect(card.title).toBe('circle.hopPrompt.title');
    expect(card.accept.label).toBe('circle.hopPrompt.accept');
  });
});

describe('rememberDismissed / hasDismissed', () => {
  it('round-trips a dismissed key (case + whitespace insensitive)', () => {
    const d1 = rememberDismissed(null, 'Badkamers');
    expect(hasDismissed(d1, 'badkamers')).toBe(true);
    expect(hasDismissed(d1, '  BADKAMERS  ')).toBe(true);
    expect(hasDismissed(d1, 'iets anders')).toBe(false);
  });

  it('produces a new Set (state-update safe)', () => {
    const before = new Set();
    const after  = rememberDismissed(before, 'x');
    expect(after).not.toBe(before);
    expect(before.has('x')).toBe(false);
    expect(after.has('x')).toBe(true);
  });

  it('hasDismissed is false for non-Set input + empty queries', () => {
    expect(hasDismissed(null, 'x')).toBe(false);
    expect(hasDismissed({}, 'x')).toBe(false);
    expect(hasDismissed(new Set(['x']), '')).toBe(false);
    expect(hasDismissed(new Set(['x']), '   ')).toBe(false);
  });

  it('ignores empty / non-string queries on remember', () => {
    const d = rememberDismissed(null, '   ');
    expect(d.size).toBe(0);
    const d2 = rememberDismissed(d, 42);
    expect(d2.size).toBe(0);
  });
});

describe('MAX_HOPS re-export', () => {
  it('re-exports the circleHop.MAX_HOPS constant so callers can pin the ceiling', () => {
    expect(MAX_HOPS).toBe(1);
  });
});

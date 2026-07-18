import { describe, it, expect } from 'vitest';
import {
  routeHelpMessage, helpTopicChips, resolveHelpTopic,
  parseHelpAction, helpTopicAction, helpConsentAction,
} from '../../src/v2/helpChat.js';
import { helpDeck } from '../../src/v2/help/kaartjes.js';

describe('helpChat · routeHelpMessage', () => {
  it('HIT (deterministic kaartje) → the card text + on-device provenance', () => {
    const r = routeHelpMessage('Wat is Basis?', { lang: 'nl', llmReady: true });
    expect(r.kind).toBe('hit');
    const card = helpDeck.kaartjes.find((k) => k.id === 'product.basis');
    expect(r.text).toBe(card.nl);
    // llmUsed:false is what lights the "answered directly — no language model" badge.
    expect(r.provenance.llmUsed).toBe(false);
    expect(r.provenance.source.cardId).toBe('product.basis');
    expect(r.provenance.source.kind).toBe('local');
  });

  it('a HIT never offers the LLM, even when one is connected', () => {
    expect(routeHelpMessage('Hoe werkt een kring?', { lang: 'nl', llmReady: true }).kind).toBe('hit');
  });

  it('MISS + an LLM connected → offer the consent card', () => {
    expect(routeHelpMessage('Bakken jullie ook pizza?', { lang: 'nl', llmReady: true })).toEqual({ kind: 'consent' });
  });

  it('MISS + NO LLM → the honest set-topics fallback', () => {
    expect(routeHelpMessage('Bakken jullie ook pizza?', { lang: 'nl', llmReady: false })).toEqual({ kind: 'topics' });
    expect(routeHelpMessage('Do you bake pizza?', { lang: 'en', llmReady: false })).toEqual({ kind: 'topics' });
  });
});

describe('helpChat · topics as chips / slash', () => {
  it('helpTopicChips lists every answerable heading with a help:topic action', () => {
    const chips = helpTopicChips({ lang: 'nl' });
    expect(chips.length).toBe(helpDeck.kaartjes.length - 1);   // excludes the fallback card
    const basis = chips.find((c) => c.action === helpTopicAction('product.basis'));
    expect(basis.label).toBe('Basis');
    expect(chips.every((c) => c.action.startsWith('help:topic:'))).toBe(true);
  });

  it('resolveHelpTopic resolves a topic id deterministically to its card', () => {
    const r = resolveHelpTopic('product.basis', { lang: 'en' });
    const card = helpDeck.kaartjes.find((k) => k.id === 'product.basis');
    expect(r.text).toBe(card.en);
    expect(r.provenance.llmUsed).toBe(false);
    expect(r.provenance.source.cardId).toBe('product.basis');
  });

  it('resolveHelpTopic rejects the fallback card + unknown ids', () => {
    expect(resolveHelpTopic(helpDeck.fallbackId, { lang: 'nl' })).toBeNull();
    expect(resolveHelpTopic('no.such.card', { lang: 'nl' })).toBeNull();
  });
});

describe('helpChat · action namespace', () => {
  it('round-trips topic + consent actions', () => {
    expect(parseHelpAction(helpTopicAction('werking.kringen'))).toEqual({ kind: 'topic', id: 'werking.kringen' });
    expect(parseHelpAction(helpConsentAction('yes'))).toEqual({ kind: 'consent', value: 'yes' });
    expect(parseHelpAction(helpConsentAction('no'))).toEqual({ kind: 'consent', value: 'no' });
  });

  it('returns null for non-help actions', () => {
    expect(parseHelpAction('onboarding:ja')).toBeNull();
    expect(parseHelpAction('slash:/done')).toBeNull();
    expect(parseHelpAction('help:')).toBeNull();
    expect(parseHelpAction(null)).toBeNull();
  });
});

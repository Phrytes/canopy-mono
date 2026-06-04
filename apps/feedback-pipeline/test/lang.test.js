// Tests for language detection + the hybrid resolver.
// Critical blocks document where detection is UNRELIABLE (short / token-heavy
// messages) — which is exactly why the resolver leans on a per-user default.
//
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, resolveLang } from '../src/lang.js';

// ── clear cases ─────────────────────────────────────────────────────
test('detects clear Dutch with high confidence', () => {
  const d = detectLang('Kan iemand de huur overmaken voor vrijdag? Het is echt nodig.');
  assert.equal(d.lang, 'nl');
  assert.equal(d.confidence, 'high');
});

test('detects clear English with high confidence', () => {
  const d = detectLang("Don't forget the rent is due this week, someone please pay it.");
  assert.equal(d.lang, 'en');
  assert.equal(d.confidence, 'high');
});

test('Dutch diacritics nudge toward NL', () => {
  assert.equal(detectLang('wéér kapot zéér vervelend').lang, 'nl');
});

// ── UNRELIABLE cases (the honest limits) ────────────────────────────
test('LIMIT: very short messages carry no signal → unknown/none', () => {
  for (const s of ['ok', 'milk', '👍', '3512']) {
    const d = detectLang(s);
    assert.equal(d.lang, 'unknown', `expected unknown for "${s}"`);
    assert.equal(d.confidence, 'none');
  }
});

test('LIMIT: a redacted, token-heavy message has little to go on', () => {
  // After step 1 most content can be tokens; detection should NOT be confident.
  const d = detectLang('[naam] [telefoonnummer] [e-mailadres] [link]');
  assert.equal(d.lang, 'unknown');
});

test('LIMIT: a single weak marker is low confidence, not high', () => {
  const d = detectLang('milk and bread');   // "and"/"bread" EN, but tiny
  assert.equal(d.lang, 'en');
  assert.notEqual(d.confidence, 'high');
});

// ── hybrid resolver ─────────────────────────────────────────────────
test('resolver: user default is used when detection is weak/unknown', () => {
  assert.equal(resolveLang({ text: 'ok', userDefault: 'nl' }).lang, 'nl');
  assert.equal(resolveLang({ text: 'ok', userDefault: 'nl' }).source, 'default');
  // low-confidence other-language guess does NOT override the default
  assert.equal(resolveLang({ text: 'milk and bread', userDefault: 'nl' }).lang, 'nl');
});

test('resolver: only a HIGH-confidence other language overrides the default', () => {
  const r = resolveLang({
    text: "Don't forget the rent is due this week, someone please pay it.",
    userDefault: 'nl',
  });
  assert.equal(r.lang, 'en');
  assert.equal(r.source, 'override');
});

test('resolver: no user default → detection, then fallback', () => {
  assert.equal(resolveLang({ text: 'Kan iemand de afwas doen?' }).lang, 'nl');
  assert.equal(resolveLang({ text: 'ok', fallback: 'en' }).source, 'fallback');
  assert.equal(resolveLang({ text: 'ok', fallback: 'en' }).lang, 'en');
});

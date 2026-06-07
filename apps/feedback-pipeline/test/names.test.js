// Critical tests for the gazetteer name redactor.
//
// This suite is deliberately adversarial: it documents BOTH failure modes
// of deterministic name redaction. The "false positive" and "false negative"
// blocks assert the WRONG-but-real behaviour on purpose — they are the
// evidence that a gazetteer is not a safe standalone anonymizer.
//
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactNames, PLACEHOLDER_NAME as N } from '../src/names.js';

// ── true positives: the cases it is meant to catch ──────────────────
test('catches known first names in name context', () => {
  assert.equal(redactNames('bel Jan even terug').text, `bel ${N} even terug`);
  assert.equal(redactNames('vraag Lisa en Peter').text, `vraag ${N} en ${N}`);
  assert.equal(redactNames('Sarah and John are coming').text, `${N} and ${N} are coming`);
});

test('lowercase homographs are left alone (capital required)', () => {
  // "mark"/"wil"/"rose" as ordinary lowercase words must survive.
  assert.equal(redactNames('ik wil de datum mark-eren').text, 'ik wil de datum mark-eren');
  assert.equal(redactNames('a single rose in lowercase').text, 'a single rose in lowercase');
});

// ── FALSE POSITIVES (known limitation) ──────────────────────────────
// Each of these redacts a word that is NOT a person here. The assertions
// capture the broken behaviour so regressions/improvements are visible.
test('FALSE POSITIVE: capitalised common words that are also names', () => {
  // imperative verb at sentence start
  assert.equal(redactNames('Mark de datum vast in je agenda').text, `${N} de datum vast in je agenda`);
  // English modal
  assert.equal(redactNames('Will you join us tonight?').text, `${N} you join us tonight?`);
  // month
  assert.equal(redactNames('May is the nicest month').text, `${N} is the nicest month`);
  // Dutch nouns: Roos (rose), Storm (storm), Bloem (flower)
  assert.equal(redactNames('Er bloeit een Roos in de tuin').text, `Er bloeit een ${N} in de tuin`);
  assert.equal(redactNames('Storm verwacht voor vannacht').text, `${N} verwacht voor vannacht`);
  // abstract nouns used as words
  assert.equal(redactNames('We did this with Grace and Hope').text, `We did this with ${N} and ${N}`);
});

test('FALSE POSITIVE: any sentence-initial gazetteer word, even mid-meaning', () => {
  // "Floor" = vloer/floor, "Beer" = bier/bear — both in the list.
  assert.equal(redactNames('Floor is nat, pas op').text, `${N} is nat, pas op`);
  assert.equal(redactNames('Beer is op, nieuwe halen').text, `${N} is op, nieuwe halen`);
});

// ── FALSE NEGATIVES (known limitation) ──────────────────────────────
// Names NOT in the gazetteer survive untouched.
test('FALSE NEGATIVE: foreign / rare first names are missed', () => {
  for (const name of ['Xanthe', 'Tariq', 'Mehmet', 'Aaliyah', 'Bjørn']) {
    const { text, hits } = redactNames(`bel ${name} even`);
    assert.equal(text, `bel ${name} even`, `unexpectedly redacted ${name}`);
    assert.equal(hits.length, 0);
  }
});

test('honorific + name redacts even an UNKNOWN surname (zorg-B published-summary leak fix)', () => {
  // "mevrouw Linda Brouwer" (Linda was not in the gazetteer) and "dr. Vermeer"
  // (bare surname) reached the published statistical summary. An honorific is a
  // high-precision signal a person name follows → redact it regardless of the list.
  assert.equal(redactNames('meneer Jansen klaagde erover').text, 'meneer [naam] klaagde erover');
  assert.equal(redactNames('Pas toen dr. Vermeer langs kwam').text, 'Pas toen dr. [naam] langs kwam');
  assert.equal(redactNames('mevrouw Linda Brouwer belde').text, 'mevrouw [naam] belde');
});

test('honorific pass keeps the FOLLOWING ordinary word (no over-redaction)', () => {
  // regression guard: under the /iu flag, \p{Lu} case-folded and ate "klaagde".
  assert.equal(redactNames('meneer Jansen klaagde erover').text, 'meneer [naam] klaagde erover');
  assert.equal(redactNames('ik wil de heer spreken').text, 'ik wil de heer spreken'); // no name → no change
});

test('FALSE NEGATIVE: a bare surname with no honorific or known first name is still missed', () => {
  assert.equal(redactNames('Jansen klaagde erover').text, 'Jansen klaagde erover');
});

test('honorific handles a particle surname (Mr. de Vries)', () => {
  assert.equal(redactNames('a Mr. de Vries replied once').text, 'a Mr. [naam] replied once');
  assert.equal(redactNames('ene meneer De Wit van Team Mobiliteit').text, 'ene meneer [naam] van Team Mobiliteit');
});

test('relational titles (neighbour/family) redact an ordinary name (civic-run leak fix)', () => {
  assert.equal(redactNames('mijn buurman Henk de Vries op nummer 14').text, 'mijn buurman [naam] op nummer 14');
  assert.equal(redactNames('Mijn buurvrouw Annelies met haar mantelzorg').text, 'Mijn buurvrouw [naam] met haar mantelzorg');
  assert.equal(redactNames('sinds mijn vrouw Annie is overleden').text, 'sinds mijn vrouw [naam] is overleden');
  assert.equal(redactNames('my neighbour Anja from the committee').text, 'my neighbour [naam] from the committee');
  // possessive-less family homograph must NOT trip ("als vrouw voel ik me…")
  assert.equal(redactNames('als vrouw voel ik me niet veilig').text, 'als vrouw voel ik me niet veilig');
});

test('KEEP a named official (policy: powerful individuals are surfaced, not redacted)', () => {
  assert.equal(redactNames('Wethouder Karim El Idrissi drukt het door').text, 'Wethouder Karim El Idrissi drukt het door');
});

test('FALSE NEGATIVE: lowercase / misspelled names are missed', () => {
  assert.equal(redactNames('bel jan even').text, 'bel jan even');       // informal lowercase
  assert.equal(redactNames('bel Jannn even').text, 'bel Jannn even');   // typo
});

// ── full-name removal (stress-test fix: surnames leaked) ────────────
test('a known first name + surname removes the WHOLE name', () => {
  assert.equal(redactNames('bel Mark Delaney terug').text, `bel ${N} terug`);
  assert.equal(redactNames('vraag Lisa Jansen even').text, `vraag ${N} even`);
});

test('a known first name alone still works (no surname required)', () => {
  assert.equal(redactNames('bel Mark even').text, `bel ${N} even`);
});

// ── placeholders from step-1 are not disturbed ──────────────────────
test('does not touch existing [placeholder] tokens', () => {
  const s = 'bel de monteur op [telefoonnummer] of mail [e-mailadres]';
  assert.equal(redactNames(s).text, s);
});

// ── job-title pass (scorecard P1: dokter/manager/afdelingshoofd leaked) ──
test('job-title + name → name redacted (private roles), incl. particle surname', () => {
  assert.match(redactNames('van dokter Smeets de medicatie').text, /dokter \[naam\]/);
  assert.match(redactNames('Afdelingshoofd Van Dijk vervalst facturen').text, /Afdelingshoofd \[naam\]/);
  assert.match(redactNames('Manager Karim vraagt gunsten').text, /Manager \[naam\]/);
});
test('job-title pass does NOT redact public officials (keep-policy) or departments', () => {
  assert.equal(redactNames('Wethouder Karim El Idrissi drukt het door').text, 'Wethouder Karim El Idrissi drukt het door');
  assert.equal(redactNames('De werkdruk op afdeling Logistiek is hoog').text, 'De werkdruk op afdeling Logistiek is hoog');
});

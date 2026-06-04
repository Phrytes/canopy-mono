// Tests for the deterministic crisis lexicon (the high-recall safety net).
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCrisis, detectSafety, detectReident, detectSensitiveContent, detectContactRequest, sensitivityFlags, isSensitiveDomain } from '../src/signals.js';

test('flags Dutch self-harm phrasings', () => {
  for (const s of [
    'Ik wil zo niet meer verder leven.',
    'ik zie het echt niet meer zitten',
    'ik wil dood',
    'ik denk aan zelfmoord',
  ]) {
    assert.equal(detectCrisis(s).isCrisis, true, `missed: "${s}"`);
  }
});

test('flags English self-harm phrasings', () => {
  for (const s of [
    'I started having dark thoughts.',
    'I want to die',
    "I don't want to be here anymore",
    'thinking about suicide',
  ]) {
    assert.equal(detectCrisis(s).isCrisis, true, `missed: "${s}"`);
  }
});

test('does NOT flag ordinary feedback', () => {
  for (const s of [
    'De wachttijden bij de GGZ zijn veel te lang.',
    'The workload is too high since the reorg.',
    'I support the new plan but worry about parking.',
  ]) {
    assert.equal(detectCrisis(s).isCrisis, false, `false positive: "${s}"`);
  }
});

test('returns which patterns matched (for the audit trail)', () => {
  const r = detectCrisis('ik wil zo niet meer verder leven');
  assert.ok(r.matches.length >= 1);
});

// ── safety lexicon ──────────────────────────────────────────────────
test('flags imminent-danger phrasings (NL + EN)', () => {
  for (const s of [
    'het is wachten op een dodelijk ongeluk',
    'Op de bouwplaats wordt met veiligheid gerommeld',
    'Veiligheidsprocedures worden stelselmatig genegeerd op de werkvloer.',
    'het is hier levensgevaarlijk',
    'The scaffolding is a death trap.',
    'someone will get hurt if this continues',
    'this is a serious injury risk',
  ]) {
    assert.equal(detectSafety(s).isSafety, true, `missed: "${s}"`);
  }
});

test('safety lexicon does NOT flag ordinary feedback', () => {
  for (const s of [
    'De wachttijden bij de GGZ zijn veel te lang.',
    'The CI/CD pipeline is too slow.',
    'I worry about parking in our street.',
  ]) {
    assert.equal(detectSafety(s).isSafety, false, `false positive: "${s}"`);
  }
});

// ── stress-test fixes: widened lexicons + new detectors ─────────────
test('crisis lexicon now catches phrasings with words between (w11 smuggle)', () => {
  assert.equal(detectCrisis('soms wil ik er gewoon niet meer zijn').isCrisis, true);
});

test('safety lexicon now catches "wachten op een dode" (w5 smuggle)', () => {
  assert.equal(detectSafety('het is wachten op een dode hier, echt waar').isSafety, true);
});

test('safety: subjective "voel me niet veilig" is NOT escalation, objective IS (civic re-tune)', () => {
  // a broken streetlight: mild civic complaint, must NOT escalate
  assert.equal(detectSafety('als vrouw voel ik me er echt niet veilig om er doorheen te lopen').isSafety, false);
  // an objective hazard statement still fires
  assert.equal(detectSafety('het is hier niet veilig, de steiger staat los').isSafety, true);
});

test('safety: genuine road hazards the civic run missed now fire', () => {
  assert.equal(detectSafety('cars do way over 50 there, we need lanes before someone dies').isSafety, true);
  assert.equal(detectSafety('mijn zoon van 7 is vorige week bijna geschept bij de oversteek').isSafety, true);
});

test('re-identification detector flags "the only X" phrasings', () => {
  assert.equal(detectReident('I am the only night-shift lab technician on site').isReident, true);
  assert.equal(detectReident('ik zit zo ongeveer als enige op die boekingen').isReident, true);
  assert.equal(detectReident('the parking is too tight').isReident, false);
});

test('reident EXCLUDES the negated form (b2 false positive fixed)', () => {
  assert.equal(detectReident('ik weet dat ik niet de enige ben').isReident, false);
  assert.equal(detectReident('I am not the only one who is worried').isReident, false);
  assert.equal(detectReident('ik ben de enige hier').isReident, true);
});

test('widened crisis lexicon catches indirect zorg phrasings (the B misses)', () => {
  for (const s of [
    'er zijn dagen dat ik niet meer wil',
    "easier if I just didn't wake up",
    'ik denk er steeds vaker over om er gewoon helemaal mee te stoppen',
    "ik wil dat ik 's ochtends gewoon niet meer wakker word, ik heb al uitgezocht hoeveel pillen ik nodig heb",
    "I shouldn't keep going",
  ]) assert.equal(detectCrisis(s).isCrisis, true, `missed: "${s}"`);
});

test('crisis: "het niet meer zien zitten" with inverted word order (Task-1 smoke miss)', () => {
  assert.equal(detectCrisis('Eerlijk gezegd zie ik het soms niet meer zitten').isCrisis, true);
  assert.equal(detectCrisis('ik zie het niet meer zitten').isCrisis, true);
  // literal sitting is not crisis
  assert.equal(detectCrisis('ik kan hier niet meer zitten, mijn rug').isCrisis, false);
});

test('FALSE POSITIVE fixed: bare "ermee stoppen" (quitting anything) is NOT crisis', () => {
  // a parking complaint "ik wil ermee stoppen" was mislabelled crisis → 113.
  assert.equal(detectCrisis('ik wil ermee stoppen bij deze polikliniek').isCrisis, false);
  assert.equal(detectCrisis('ik ga ermee stoppen met deze sport').isCrisis, false);
  // but the qualified resignation form and life/totality phrasings still fire
  assert.equal(detectCrisis('ik wil er gewoon mee stoppen').isCrisis, true);
  assert.equal(detectCrisis('ik wil met alles stoppen').isCrisis, true);
  assert.equal(detectCrisis('ik wil met het leven stoppen').isCrisis, true);
});

test('detectSensitiveContent flags harassment/fraud/abuse in RAW text (quarantine even if mislabelled)', () => {
  assert.equal(detectSensitiveContent('mijn teamlead vraagt seksuele gunsten in ruil voor promotie').isSensitive, true);
  assert.equal(detectSensitiveContent('hij sluist geld weg, pure corruptie').isSensitive, true);
  assert.equal(detectSensitiveContent('I was bullied and humiliated in front of the team').isSensitive, true);
  // w9-style discrimination is caught by re-id even if content words are subtle:
  assert.equal(detectReident('I am the only female engineer here').isReident, true);
  // ordinary feedback is not flagged
  assert.equal(detectSensitiveContent('the parking is too tight and the canteen is closed').isSensitive, false);
});

test('isSensitiveDomain marks safety/harassment/integrity etc. (quarantine trigger)', () => {
  for (const d of ['safety', 'harassment', 'integrity', 'fraud', 'discrimination', 'veiligheid', 'misbruik']) {
    assert.equal(isSensitiveDomain(d), true, `expected sensitive: ${d}`);
  }
  for (const d of ['parking', 'workload', 'greenery', 'pay']) {
    assert.equal(isSensitiveDomain(d), false, `expected non-sensitive: ${d}`);
  }
});

// ── refinement A: PII-only "contact me" detection ───────────────────
test('detectContactRequest flags "contact me" messages (w10-style)', () => {
  assert.equal(detectContactRequest('wil graag dat iemand contact met me opneemt, je kunt me bereiken op ...').isContact, true);
  assert.equal(detectContactRequest('call me on my mobile and I will send you the evidence').isContact, true);
  assert.equal(detectContactRequest('de wachtlijst bij de GGZ is veel te lang').isContact, false);
});

// ── refinement B: human-readable quarantine reasons ─────────────────
test('sensitivityFlags explains why a message was quarantined', () => {
  assert.deepEqual(sensitivityFlags('I am the only female engineer at the depot'), ['self-identifying ("only X")']);
  assert.ok(sensitivityFlags('hij vraagt seksuele gunsten voor promotie').includes('sensitive content'));
  assert.deepEqual(sensitivityFlags('the printer is broken again'), []);
});

test('crisis and safety are distinguished', () => {
  assert.equal(detectCrisis('ik wil niet meer leven').isCrisis, true);
  assert.equal(detectSafety('ik wil niet meer leven').isSafety, false);
  assert.equal(detectSafety('wachten op een dodelijk ongeluk').isSafety, true);
  assert.equal(detectCrisis('wachten op een dodelijk ongeluk').isCrisis, false);
});

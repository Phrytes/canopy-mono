// Unit tests for the deterministic regex pre-pass (step 1).
// Runs with the built-in test runner — `node --test` — no Ollama, no deps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactText, PLACEHOLDER } from '../src/redact.js';

test('email is redacted', () => {
  const { text, hits } = redact('mail jan@reparatie.nl voor de afspraak');
  assert.equal(text, `mail ${PLACEHOLDER.email} voor de afspraak`);
  assert.deepEqual(hits.map((h) => h.type), ['email']);
});

test('url is redacted', () => {
  assert.equal(
    redactText('het formulier staat op https://forms.example/abc123 alsjeblieft'),
    `het formulier staat op ${PLACEHOLDER.url} alsjeblieft`,
  );
});

test('IBAN is redacted (with spaces)', () => {
  assert.equal(
    redactText('maak over naar IBAN NL12 RABO 0123 4567 89 voor vrijdag'),
    `maak over naar IBAN ${PLACEHOLDER.iban} voor vrijdag`,
  );
});

test('Dutch postcode is redacted', () => {
  assert.equal(redactText('zij woont op 3512 JK in het centrum'),
    `zij woont op ${PLACEHOLDER.postcode} in het centrum`);
});

test('street + house number is redacted', () => {
  assert.equal(redactText('We wonen op Kerkstraat 12 in Utrecht'),
    `We wonen op ${PLACEHOLDER.address} in Utrecht`);
});

test('NL phone numbers in several formats are redacted', () => {
  for (const phone of ['0612345678', '06-1234 5678', '030-1234567', '+31 6 12345678']) {
    const { text, hits } = redact(`bel ${phone} maar`);
    assert.equal(text, `bel ${PLACEHOLDER.phone} maar`, `failed for "${phone}"`);
    assert.equal(hits[0].type, 'phone');
  }
});

test('dates and money are NOT mistaken for phone numbers', () => {
  // a numeric date is redacted as [datum] (not phone); money/ages untouched
  assert.equal(redactText('op 2026-06-02 kost het 20 euro'), `op ${PLACEHOLDER.date} kost het 20 euro`);
  assert.equal(redactText('hij is 12 jaar en woont hier 3 maanden'), 'hij is 12 jaar en woont hier 3 maanden');
});

test('a clean message is returned unchanged', () => {
  const msg = 'good morning everyone, hope you slept well';
  const { text, hits } = redact(msg);
  assert.equal(text, msg);
  assert.equal(hits.length, 0);
});

test('multiple identifiers in one message all get caught', () => {
  const { hits } = redact('bel Jan op 0612345678 of mail jan@reparatie.nl');
  const types = hits.map((h) => h.type).sort();
  assert.deepEqual(types, ['email', 'phone']);
});

test('names are deliberately NOT touched (that is the LLM step)', () => {
  // "Jan" survives the regex pass — step 2 removes names.
  assert.match(redactText('bel Jan op 0612345678'), /Jan/);
});

// ── FALSE POSITIVES of the STRUCTURED regex (known limitations) ──────
// Even rigid patterns over-match when ordinary text coincides with the
// shape. These assert the wrong-but-real behaviour so it's documented.

test('FALSE POSITIVE: a year + 2-letter abbreviation looks like a postcode', () => {
  // "2024 AD" / "1066 AD" match \d{4} [A-Z]{2}. Not postcodes.
  assert.equal(redactText('in het jaar 2024 AD'), `in het jaar ${PLACEHOLDER.postcode}`);
  assert.equal(redactText('the battle of 1066 AD'), `the battle of ${PLACEHOLDER.postcode}`);
});

test('FALSE POSITIVE: an order/reference number shaped like an NL mobile', () => {
  // A 10-digit order number starting 06 is indistinguishable from a phone.
  assert.equal(redactText('bestelnummer 0612345678 is verzonden'),
    `bestelnummer ${PLACEHOLDER.phone} is verzonden`);
});

test('FALSE POSITIVE: a product SKU shaped like an IBAN', () => {
  // 2 letters + 2 digits + alnum run → matches the IBAN rule.
  assert.equal(redactText('artikel NL21ABCD1234567890 op voorraad'),
    `artikel ${PLACEHOLDER.iban} op voorraad`);
});

test('FALSE POSITIVE: a highway / non-home "street+number" is redacted as address', () => {
  // "Snelweg 12" (a motorway) is not a home address, but matches.
  assert.equal(redactText('we reden over de Snelweg 12 vanochtend'),
    `we reden over de ${PLACEHOLDER.address} vanochtend`);
});

// ── FALSE NEGATIVES of the STRUCTURED regex (known limitations) ──────

test('ROBUSTNESS: phone with pair-spaced digits is still caught', () => {
  // Empirically the candidate+validator normalises internal spacing, so
  // "06 12 34 56 78" → a valid NL mobile → redacted. (My initial guess that
  // this would be missed was wrong; the test now documents the real behaviour.)
  assert.equal(redactText('bel 06 12 34 56 78 maar'), `bel ${PLACEHOLDER.phone} maar`);
});

test('international phone numbers are now caught (was a gap; fixed after stress test)', () => {
  assert.equal(redactText('call +1 415 555 0123'), `call ${PLACEHOLDER.phone}`);
});

test('FALSE NEGATIVE: city without street/number is not an address to the regex', () => {
  // "Utrecht" alone carries location signal but has no structure to match.
  assert.equal(redactText('we wonen in Utrecht'), 'we wonen in Utrecht');
});

// ── BSN (personal national ID; checksum-validated) ──────────────────

test('a numeric date (DOB) is redacted', () => {
  assert.equal(redactText('geboortedatum 12-03-1991 graag'), `geboortedatum ${PLACEHOLDER.date} graag`);
  assert.equal(redactText('op 2026-06-02 had ik een afspraak'), `op ${PLACEHOLDER.date} had ik een afspraak`);
});

test('a labelled BSN is redacted even if it fails the 11-proef', () => {
  const out = redactText('mijn BSN is 184729356 voor het dossier');  // 184729356 fails checksum
  assert.match(out, /\[bsn\]/);
  assert.doesNotMatch(out, /184729356/);
});

test('a labelled dossier/case number is redacted', () => {
  assert.match(redactText('mijn dossiernummer is 84422190 graag'), /\[dossiernummer\] graag/);
});

test('a valid BSN (passes 11-proef) is redacted', () => {
  const { text, hits } = redact('mijn BSN is 123456782 voor het dossier');
  assert.equal(text, `mijn BSN is ${PLACEHOLDER.bsn} voor het dossier`);
  assert.equal(hits.find((h) => h.type === 'bsn')?.value, '123456782');
});

test('a 9-digit number that FAILS the checksum is left alone (FP guard)', () => {
  // 123456789 does not satisfy the 11-proef → not treated as a BSN.
  assert.equal(redactText('ordernummer 123456789 verzonden'), 'ordernummer 123456789 verzonden');
});

test('an 8-digit KvK number is not a BSN and is left alone', () => {
  // KvK identifies a company; policy keeps it, and 8 digits != 9 anyway.
  assert.equal(redactText('eigen BV met KvK 12345678'), 'eigen BV met KvK 12345678');
});

// ── stress-test fixes: obfuscated / foreign PII ─────────────────────

test('obfuscated email is redacted before the LLM can reconstruct it', () => {
  assert.equal(redactText('mail me op jan dot devries at gmail dot com graag'),
    `mail me op ${PLACEHOLDER.email} graag`);
});

test('international (+CC) phone numbers are redacted', () => {
  assert.equal(redactText('bel me op +49 171 2345678 als je wilt'),
    `bel me op ${PLACEHOLDER.phone} als je wilt`);
});

test('a spaced/grouped valid BSN is redacted', () => {
  // 111111110 passes the 11-proef; spaced form must still be caught.
  assert.equal(redactText('mijn nummer is 1111 11 110 voor de administratie'),
    `mijn nummer is ${PLACEHOLDER.bsn} voor de administratie`);
});

test('LIMIT: a non-BSN 9-digit number that happens to pass the checksum is a residual FP', () => {
  // The checksum only filters ~10/11 of random 9-digit numbers; the rest are
  // unavoidable false positives. 111111110 satisfies the 11-proef.
  assert.equal(redactText('referentie 111111110'), `referentie ${PLACEHOLDER.bsn}`);
});

// M4 — scenario PII floors: labelled case / dossier / student / reference numbers are redacted
// (the keyword prefix keeps false positives low). Complements test/redact.test.js.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/redact.js';

const red = (s) => redact(s).text;

test('student / case / reference numbers are floored', () => {
  for (const s of [
    'mijn studentnummer is 1234567',
    'leerlingnummer: 884422',
    'student number 1234567',
    'case no. 84422',
    'reference number 553201',
    'dossiernummer 84422190',
    'zaaknummer is 99201',
  ]) {
    const out = red(s);
    assert.ok(!/\d{4,12}/.test(out), `digits should be redacted in: "${s}" → "${out}"`);
    assert.ok(/\[dossiernummer\]/.test(out), `placeholder present in: "${out}"`);
  }
});

test('ordinary numbers without a sensitive label are NOT over-redacted', () => {
  const out = red('de wachtlijst is al 8 maanden en bus 12 rijdt niet');
  assert.match(out, /8 maanden/);
  assert.match(out, /bus 12/);
});

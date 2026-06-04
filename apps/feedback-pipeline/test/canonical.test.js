// Tests for label normalisation (merge near-duplicate domains before the
// k-threshold, so the statistical track stops fragmenting).
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalDomain } from '../src/triage.js';

test('the safety family merges to one theme', () => {
  for (const d of ['safety', 'personal-safety', 'transport safety', 'dangerous_crossing', 'verkeersveiligheid', 'road safety']) {
    assert.equal(canonicalDomain(d), 'safety', `expected ${d} → safety`);
  }
});

test('the waiting-times family merges', () => {
  for (const d of ['care waiting times', 'waiting times', 'wachttijden', 'wachtlijst']) {
    assert.equal(canonicalDomain(d), 'waiting times', `expected ${d} → waiting times`);
  }
});

test('unrelated labels are normalised but NOT merged', () => {
  assert.equal(canonicalDomain('Parking'), 'parking');
  assert.equal(canonicalDomain('waste_management'), 'waste management');
  assert.equal(canonicalDomain('food safety'), 'food safety');   // not the safety family
  assert.equal(canonicalDomain(null), 'general');
});

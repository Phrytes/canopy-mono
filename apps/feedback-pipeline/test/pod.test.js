// Unit tests for the central-pod data layer (Phase 2): contribution schema,
// status model, manifest helpers.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContribution, buildContribution } from '../src/pod/contribution.js';
import { canWithdraw } from '../src/pod/central-pod.js';
import { buildManifest, withdrawalViolations } from '../src/pod/manifest.js';

test('contribution schema: valid passes; identity/unknown keys and precise time rejected', () => {
  const c = validateContribution({ id: 'x', text: 'hoi', timeWindow: '2026-Q2', lang: 'nl' });
  assert.deepEqual(c.themeTags, []);                                       // default
  assert.throws(() => validateContribution({ id: 'x' }));                   // no text
  assert.throws(() => validateContribution({ id: 'x', text: 't', participant: 'p' })); // identity smuggle (.strict)
  assert.throws(() => validateContribution({ id: 'x', text: 't', timeWindow: '2026-06-04' })); // too precise
});

test('buildContribution from a Task-1 point', () => {
  const c = buildContribution({ id: 'p1', text: 'punt' }, { timeWindow: '2026', lang: 'nl', themeTags: ['parking'] });
  assert.equal(c.id, 'p1');
  assert.equal(c.text, 'punt');
  assert.deepEqual(c.themeTags, ['parking']);
});

test('status: withdrawal only before release', () => {
  assert.equal(canWithdraw('submitted'), true);
  assert.equal(canWithdraw('included'), false);
  assert.equal(canWithdraw('withdrawn'), false);
});

test('manifest dedups + detects withdrawal violations', () => {
  const m = buildManifest({ reportId: 'r', createdAt: '2026-06-04T00:00:00Z', includedContributionIds: ['a', 'a', 'b'] });
  assert.deepEqual(m.includedContributionIds.sort(), ['a', 'b']);
  assert.deepEqual(withdrawalViolations(m, ['b']), ['b']);   // b withdrawn yet in report → violation
  assert.deepEqual(withdrawalViolations(m, ['z']), []);
});

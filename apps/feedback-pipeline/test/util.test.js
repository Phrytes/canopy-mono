// Tests for token shielding (lossless round-trip) used around translate/summarize.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shield, unshield } from '../src/util.js';

test('shields canonical tokens to opaque markers and restores them', () => {
  const t = 'Bel de monteur op [telefoonnummer] of mail [e-mailadres], naam [naam].';
  const { shielded, map } = shield(t);
  assert.match(shielded, /\[\[0\]\]/);
  assert.ok(!/telefoonnummer/.test(shielded));      // canonical token hidden
  assert.equal(map.length, 3);
  assert.equal(unshield(shielded, map), t);          // lossless round-trip
});

test('round-trips even if the model reordered the markers', () => {
  const { map } = shield('a [telefoonnummer] b [adres]');
  // model output with markers swapped / reworded around them:
  assert.equal(unshield('see [[1]] then call [[0]]', map),
    'see [adres] then call [telefoonnummer]');
});

test('text with no tokens is unchanged', () => {
  const { shielded, map } = shield('gewoon een bericht zonder tokens');
  assert.equal(shielded, 'gewoon een bericht zonder tokens');
  assert.equal(map.length, 0);
  assert.equal(unshield(shielded, map), 'gewoon een bericht zonder tokens');
});

test('an unknown marker index is left as-is (no crash)', () => {
  assert.equal(unshield('stray [[9]] marker', ['[telefoonnummer]']), 'stray [[9]] marker');
});

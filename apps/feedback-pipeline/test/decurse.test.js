// Tests for the deterministic profanity floor of the de-curse pass.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decurseDeterministic, hasProfanity } from '../src/decurse.js';

test('removes known profanity and tidies spacing', () => {
  const { text, removed } = decurseDeterministic('Godverdomme het is hier levensgevaarlijk');
  assert.equal(text, 'het is hier levensgevaarlijk');
  assert.ok(removed >= 1);
});

test('strips only swears, keeps severity/emotion words', () => {
  assert.equal(decurseDeterministic('this fucking scaffolding is a fatal death trap').text,
    'this scaffolding is a fatal death trap');
  assert.equal(decurseDeterministic('I am absolutely terrified, this is toxic').text,
    'I am absolutely terrified, this is toxic');
});

test('hasProfanity flags leftovers (self-check)', () => {
  assert.equal(hasProfanity('what an idiot'), true);
  assert.equal(hasProfanity('godverdomme'), true);
  assert.equal(hasProfanity('the deadline is impossible'), false);
});

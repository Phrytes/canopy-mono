// Tests for the Task-1 pure helpers (the LLM orchestration is exercised by
// scripts/task1-smoke.js against a running model).
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePoints } from '../src/task1.js';

test('parsePoints extracts addressable points from a bullet list', () => {
  const pts = parsePoints('- GGZ wachtlijst te lang\n- Parkeren te duur\n\nsome preamble\n• Afval te weinig geleegd');
  assert.equal(pts.length, 3);
  assert.equal(pts[0].id, 'p1');
  assert.equal(pts[0].text, 'GGZ wachtlijst te lang');
  assert.equal(pts[2].id, 'p3');
  assert.equal(pts[2].text, 'Afval te weinig geleegd');
});

test('parsePoints ignores non-bullet and empty lines', () => {
  assert.equal(parsePoints('preamble\nno bullets here').length, 0);
  assert.equal(parsePoints('').length, 0);
  assert.equal(parsePoints('-\n-   \n- real point').length, 1);   // empty bullets dropped
});

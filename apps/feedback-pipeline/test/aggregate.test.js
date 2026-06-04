// Tests for the pure k-anonymity threshold logic (no LLM).
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionByThreshold, routesToSignalLabel } from '../src/aggregate.js';

test('routesToSignalLabel: floor-confirmed always escalates, LLM-only is project-gated', () => {
  // a deterministically-confirmed signal (via set) always routes, even if the
  // project did not list the category — the guarantee.
  assert.equal(routesToSignalLabel({ signal: 'crisis', via: 'crisis-lexicon' }, ['safety']), true);
  // an LLM-only signal is gated by the project's escalation list.
  assert.equal(routesToSignalLabel({ signal: 'crisis' }, ['safety']), false);   // not enabled
  assert.equal(routesToSignalLabel({ signal: 'crisis' }, ['crisis']), true);    // enabled
  assert.equal(routesToSignalLabel({ signal: 'crisis' }, null), true);          // no filter = all
  // integrity is a sensitive singleton — always pulled out, not project-gated.
  assert.equal(routesToSignalLabel({ signal: 'integrity' }, ['safety']), true);
  // non-escalation, non-integrity → never a signal.
  assert.equal(routesToSignalLabel({ signal: 'none' }, null), false);
  assert.equal(routesToSignalLabel(null), false);
});

const groups = {
  parking:       { users: new Set(['p1', 'p3', 'p7', 'p10']), msgs: [1, 2, 3, 4] },
  greenery:      { users: new Set(['p2', 'p4', 'p9']),        msgs: [1, 2, 3] },
  cyclingSafety: { users: new Set(['p3', 'p9']),              msgs: [1, 2] },   // below
  terraceNoise:  { users: new Set(['p4']),                    msgs: [1] },      // below
};

test('keeps themes with >= k DISTINCT users, drops the rest', () => {
  const { meeting, dropped } = partitionByThreshold(groups, 3);
  assert.deepEqual(meeting.map((m) => m.theme), ['parking', 'greenery']); // sorted by userCount desc
  assert.deepEqual(dropped.map((m) => m.theme).sort(), ['cyclingSafety', 'terraceNoise']);
});

test('counts DISTINCT users, not messages', () => {
  // same user posting twice must not push a theme over the threshold
  const g = { x: { users: new Set(['p1', 'p1', 'p2']), msgs: [1, 2, 3] } };
  const { meeting, dropped } = partitionByThreshold(g, 3);
  assert.equal(meeting.length, 0);
  assert.equal(dropped[0].userCount, 2);   // p1 counted once
  assert.equal(dropped[0].messageCount, 3);
});

test('raising k drops more themes (the privacy dial)', () => {
  assert.equal(partitionByThreshold(groups, 4).meeting.map((m) => m.theme).join(), 'parking');
  assert.equal(partitionByThreshold(groups, 5).meeting.length, 0);
});

// Tests for the project-driven entry points (the ProjectConfig → pipeline seam).
// The full LLM run is exercised by the smokes; here we check that an empty input
// flows through the config wrapper without an LLM call.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTask1ForProject, aggregateForProject } from '../src/run.js';
import { exampleProjectConfig } from '../src/config/project-config.js';

test('runTask1ForProject with no messages returns an empty structure (no LLM call)', async () => {
  const r = await runTask1ForProject([], exampleProjectConfig);
  assert.deepEqual(r.perMessage, []);
  assert.deepEqual(r.points, []);
  assert.deepEqual(r.signals, []);
  assert.deepEqual(r.rejected, []);
  assert.equal(r.lang, 'nl');                 // from config.language.preferred
});

test('aggregateForProject with no items returns empty tracks (k from config)', async () => {
  const r = await aggregateForProject([], exampleProjectConfig);
  assert.equal(r.kThreshold, 4);              // from config.aggregation.k
  assert.deepEqual(r.statistical, []);
  assert.deepEqual(r.signals, []);
  assert.equal(r.totalMessages, 0);
});

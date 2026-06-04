// Tests for the per-project config schema (the "form").
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectConfig, exampleProjectConfig } from '../src/config/project-config.js';

test('the worked example validates and fills defaults', () => {
  const cfg = validateProjectConfig(exampleProjectConfig);
  assert.equal(cfg.projectId, 'gemeente-x-wijkvernieuwing-2026');
  assert.equal(cfg.aggregation.k, 4);
  assert.equal(cfg.review.mode, 'notification');
  assert.equal(cfg.signal.layer1OnDevice, false);          // provisional, off by default
  assert.deepEqual(cfg.signal.escalationCategories, ['crisis', 'safety']);
});

test('a minimal config fills sensible defaults', () => {
  const cfg = validateProjectConfig({
    projectId: 'p1',
    llm: { route: 'local', model: 'qwen2.5:7b-instruct' },
    aggregation: { k: 5 },
  });
  assert.equal(cfg.language.preferred, 'nl');
  assert.equal(cfg.review.mode, 'notification');           // D2 default
  assert.equal(cfg.aggregation.belowThreshold, 'quarantine');
  assert.equal(cfg.retention.ownPod, 'until-delete');
  assert.equal(cfg.signal.escalationCategories.length, 6); // full set by default
});

test('required per-project fields are enforced (no universal default)', () => {
  assert.throws(() => validateProjectConfig({ projectId: 'p', llm: { route: 'local', model: 'm' } }), /aggregation/i); // missing k
  assert.throws(() => validateProjectConfig({ projectId: 'p', aggregation: { k: 4 } }), /llm/i);                       // missing route/model
  assert.throws(() => validateProjectConfig({ projectId: 'p', llm: { route: 'space-laser', model: 'm' }, aggregation: { k: 4 } })); // bad route
});

test('retention accepts a days:N window', () => {
  const cfg = validateProjectConfig({
    projectId: 'p', llm: { route: 'local', model: 'm' }, aggregation: { k: 4 },
    retention: { ownPod: 'days:90' },
  });
  assert.equal(cfg.retention.ownPod, 'days:90');
});

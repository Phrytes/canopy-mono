// Integration tests for the central-pod flow (Phase 2): write → list → withdraw →
// markIncluded, defensive validation, the manifest guarantee, and the central-pod →
// Task-2 aggregation coupling (against the mock LLM, no re-clean of consented text).
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { buildContribution } from '../src/pod/contribution.js';
import { buildManifest, withdrawalViolations } from '../src/pod/manifest.js';
import { aggregateForProject } from '../src/run.js';
import { validateProjectConfig } from '../src/config/project-config.js';

test('central pod: write → list → withdraw before release; included blocks withdrawal', () => {
  const pod = new InMemoryCentralPod();
  pod.write('part-a', buildContribution({ id: 'a-p1', text: 'De wachtlijst bij de GGZ is te lang.' }, { lang: 'nl' }));
  pod.write('part-a', buildContribution({ id: 'a-p2', text: 'Parkeren is te duur.' }));
  pod.write('part-b', buildContribution({ id: 'b-p1', text: 'GGZ wachtlijst veel te lang.' }));
  assert.equal(pod.list().length, 3);

  pod.withdraw('part-a', 'a-p2');                          // withdraw before release
  assert.equal(pod.getStatus('a-p2'), 'withdrawn');
  assert.equal(pod.list().length, 2);

  assert.throws(() => pod.withdraw('part-b', 'a-p1'), /not found/);   // not your contribution
  assert.throws(() => pod.write('part-a', buildContribution({ id: 'a-p1', text: 'dup' })), /duplicate/);

  pod.markIncluded(['a-p1']);                             // released
  assert.equal(pod.getStatus('a-p1'), 'included');
  assert.throws(() => pod.withdraw('part-a', 'a-p1'), /cannot withdraw/);
});

test('defensive validation rejects malformed / identity-smuggling writes', () => {
  const pod = new InMemoryCentralPod();
  assert.throws(() => pod.write('p', { id: 'x' }));                          // no text
  assert.throws(() => pod.write('p', { id: 'x', text: 't', name: 'Jan' }));  // unknown key
});

test('manifest guarantee: a withdrawn contribution is absent from the released report', () => {
  const m = buildManifest({ reportId: 'r1', createdAt: '2026-06-04T00:00:00Z', includedContributionIds: ['a-p1', 'b-p1'] });
  assert.deepEqual(withdrawalViolations(m, ['a-p2']), []);   // a-p2 withdrawn, not in report → consistent
});

test('central pod → Task-2 aggregation (mock LLM, consented text not re-cleaned)', async (t) => {
  const mock = await startMockLlm();
  const prev = process.env.FP_LLM_BASEURL;
  process.env.FP_LLM_BASEURL = mock.url;
  t.after(async () => {
    if (prev === undefined) delete process.env.FP_LLM_BASEURL; else process.env.FP_LLM_BASEURL = prev;
    await mock.close();
  });

  const pod = new InMemoryCentralPod();
  pod.write('a', buildContribution({ id: 'a1', text: 'De wachtlijst bij de GGZ is te lang.' }, { lang: 'nl' }));
  pod.write('b', buildContribution({ id: 'b1', text: 'GGZ wachtlijst veel te lang.' }, { lang: 'nl' }));
  const cfg = validateProjectConfig({ projectId: 'p', llm: { route: 'local', model: 'mock' }, aggregation: { k: 2 } });

  const res = await aggregateForProject(pod.forAggregation(), cfg, { skipClean: true });
  assert.equal(res.totalMessages, 2);
  assert.ok(res.statistical.some((s) => s.theme === 'waiting times'), 'GGZ theme surfaces at k=2');
});

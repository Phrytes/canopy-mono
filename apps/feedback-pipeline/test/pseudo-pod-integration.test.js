// Substrate integration: the Phase-2 central pod running on the REAL @canopy/pseudo-pod
// store (write/read/list/delete over a memory backend), then flowing into Task-2
// aggregation. Proves the interface works on the actual substrate, not just the stub.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { PseudoPodCentralPod } from '../src/pod/pseudo-central-pod.js';
import { buildContribution } from '../src/pod/contribution.js';
import { aggregateForProject } from '../src/run.js';
import { validateProjectConfig } from '../src/config/project-config.js';

test('central pod on @canopy/pseudo-pod: write → list → withdraw → markIncluded', async () => {
  const pod = new PseudoPodCentralPod();
  await pod.write('part-a', buildContribution({ id: 'a1', text: 'GGZ wachtlijst te lang.' }, { lang: 'nl' }));
  await pod.write('part-a', buildContribution({ id: 'a2', text: 'Parkeren te duur.' }));
  await pod.write('part-b', buildContribution({ id: 'b1', text: 'GGZ wachtlijst veel te lang.' }, { lang: 'nl' }));

  assert.equal((await pod.list()).length, 3);
  assert.equal(await pod.getStatus('a1'), 'submitted');
  await assert.rejects(pod.write('part-a', buildContribution({ id: 'a1', text: 'dup' })), /duplicate/);

  await pod.withdraw('part-a', 'a2');                       // delete from the real store
  assert.equal((await pod.list()).length, 2);
  assert.equal(await pod.getStatus('a2'), null);

  await pod.markIncluded(['a1']);                           // read-modify-write on the real store
  assert.equal(await pod.getStatus('a1'), 'included');
  await assert.rejects(pod.withdraw('part-a', 'a1'), /cannot withdraw/);
});

test('pseudo-pod central pod → Task-2 aggregation (mock LLM)', async (t) => {
  const mock = await startMockLlm();
  const prev = process.env.FP_LLM_BASEURL;
  process.env.FP_LLM_BASEURL = mock.url;
  t.after(async () => {
    if (prev === undefined) delete process.env.FP_LLM_BASEURL; else process.env.FP_LLM_BASEURL = prev;
    await mock.close();
  });

  const pod = new PseudoPodCentralPod();
  await pod.write('a', buildContribution({ id: 'a1', text: 'De wachtlijst bij de GGZ is te lang.' }, { lang: 'nl' }));
  await pod.write('b', buildContribution({ id: 'b1', text: 'GGZ wachtlijst veel te lang.' }, { lang: 'nl' }));

  const cfg = validateProjectConfig({ projectId: 'p', llm: { route: 'local', model: 'mock' }, aggregation: { k: 2 } });
  const res = await aggregateForProject(await pod.forAggregation(), cfg, { skipClean: true });
  assert.equal(res.totalMessages, 2);
  assert.ok(res.statistical.some((s) => s.theme === 'waiting times'), 'GGZ theme surfaces from the pseudo-pod-backed pod');
});

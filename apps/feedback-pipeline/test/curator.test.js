// Curator workspace — the Task-2 review/release side. Proves the full chain pod → aggregate
// → curator review → release, and the two release guarantees: included contributions are
// marked in the pod (withdrawal blocked) + recorded in a verifiable manifest; the
// transparency counters account for ALL input.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { buildContribution } from '../src/pod/contribution.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { aggregateForProject } from '../src/run.js';
import { createCuratorWorkspace } from '../src/curator/workspace.js';
import { renderReport } from '../src/curator/render.js';
import { withdrawalViolations } from '../src/pod/manifest.js';
import { getStrings } from '../src/strings/index.js';

const NOW = '2026-06-05T12:00:00Z';
const config = () => validateProjectConfig({ projectId: 'r', llm: { route: 'local', model: 'mock' }, aggregation: { k: 2 } });

let openMocks = [];
afterEach(async () => { for (const m of openMocks) await m.close(); openMocks = []; });

// k=2: "waiting times" has 2 participants (meets k) → statistical; "food" has 1 → below k →
// quarantined for review (the project's never-silently-drop default).
async function fixture() {
  const mock = await startMockLlm();
  openMocks.push(mock);
  process.env.FP_LLM_BASEURL = mock.url;
  const pod = new InMemoryCentralPod();
  await pod.write('p1', buildContribution({ id: 'p1:1', text: 'De GGZ wachtlijst is veel te lang' }, { lang: 'nl' }));
  await pod.write('p2', buildContribution({ id: 'p2:1', text: 'GGZ wachtlijst echt veel te lang' }, { lang: 'nl' }));
  await pod.write('p3', buildContribution({ id: 'p3:1', text: 'het eten in de kantine is slecht' }, { lang: 'nl' }));
  const aggregate = await aggregateForProject(await pod.forAggregation(), config(), { skipClean: true });
  return { pod, aggregate };
}

test('review: default-include statistical themes + live counters', async () => {
  const { pod, aggregate } = await fixture();
  const ws = createCuratorWorkspace({ aggregate, pod, reportId: 'r1' });
  const r = ws.review();
  const waiting = r.themes.find((t) => t.theme === 'waiting times');
  assert.ok(waiting && waiting.included, 'waiting times included by default');
  assert.equal(r.counters.participants, 3);
  assert.equal(r.counters.contributions, 3);
  assert.equal(r.counters.themesFound, 1);
  assert.equal(r.counters.themesBelowThreshold, 1);   // food, too few people
  assert.equal(r.counters.kThreshold, 2);
});

test('release: marks included contributions, builds a verifiable manifest', async () => {
  const { pod, aggregate } = await fixture();
  const ws = createCuratorWorkspace({ aggregate, pod, reportId: 'r1' });
  const { report, manifest, counters } = await ws.release({ now: NOW });

  assert.deepEqual([...manifest.includedContributionIds].sort(), ['p1:1', 'p2:1']);
  assert.equal(report.themes.length, 1);
  assert.equal(counters.contributionsIncluded, 2);

  // included → withdrawal blocked
  assert.equal(pod.getStatus('p1:1'), 'included');
  assert.throws(() => pod.withdraw('p1', 'p1:1'), /cannot withdraw/);

  // not included (below-k food) → still withdrawable, and NOT in the manifest
  assert.equal(pod.getStatus('p3:1'), 'submitted');
  assert.deepEqual(withdrawalViolations(manifest, ['p3:1']), []);
});

test('curator can drop a theme → excluded from report + manifest', async () => {
  const { pod, aggregate } = await fixture();
  const ws = createCuratorWorkspace({ aggregate, pod, reportId: 'r1' });
  ws.dropTheme('waiting times');
  assert.equal(ws.review().counters.themesIncluded, 0);
  const { manifest } = await ws.release({ now: NOW });
  assert.deepEqual(manifest.includedContributionIds, []);
  assert.equal(pod.getStatus('p1:1'), 'submitted');   // nothing released → still withdrawable
});

test('withdraw-before-release stays out of the report (verifiable)', async () => {
  const mock = await startMockLlm(); openMocks.push(mock);
  process.env.FP_LLM_BASEURL = mock.url;
  const pod = new InMemoryCentralPod();
  await pod.write('p1', buildContribution({ id: 'p1:1', text: 'De GGZ wachtlijst is veel te lang' }, { lang: 'nl' }));
  await pod.write('p2', buildContribution({ id: 'p2:1', text: 'GGZ wachtlijst echt veel te lang' }, { lang: 'nl' }));
  pod.withdraw('p2', 'p2:1');                          // withdrawn BEFORE aggregation
  const aggregate = await aggregateForProject(await pod.forAggregation(), config(), { skipClean: true });
  const ws = createCuratorWorkspace({ aggregate, pod, reportId: 'r1' });
  const { manifest } = await ws.release({ now: NOW });
  assert.ok(!manifest.includedContributionIds.includes('p2:1'));
  assert.deepEqual(withdrawalViolations(manifest, ['p2:1']), []);
});

test('renderReport is localised (nl + en)', async () => {
  const { aggregate } = await fixture();
  const ws = createCuratorWorkspace({ aggregate, reportId: 'r1' });   // no pod = dry render
  const { report } = await ws.release({ now: NOW });
  const nl = renderReport(report, getStrings('nl'));
  const en = renderReport(report, getStrings('en'));
  assert.match(nl, /Rapport r1/);
  assert.match(nl, /Verantwoording/);
  assert.match(nl, /deelnemers/);
  assert.match(en, /Report r1/);
  assert.match(en, /Accountability/);
});

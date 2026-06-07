// Curator workspace demo — the Task-2 review/release side, end to end and self-contained
// (starts an in-process mock LLM, so it runs with no Ollama / no network):
//   pod (consented contributions) -> aggregate (k-anon) -> curator review -> release
//   -> marked included in the pod + a verifiable manifest + a published report.
//
//   node scripts/curator-smoke.js   (or: npm run curator-smoke)

import { startMockLlm } from '../test/helpers/mock-llm.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { buildContribution } from '../src/pod/contribution.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { aggregateForProject } from '../src/run.js';
import { createCuratorWorkspace } from '../src/curator/workspace.js';
import { renderReport } from '../src/curator/render.js';
import { getStrings } from '../src/strings/index.js';

const mock = await startMockLlm();
process.env.FP_LLM_BASEURL = mock.url;

const pod = new InMemoryCentralPod();
const contributions = [
  ['p1', 'De GGZ wachtlijst is al maanden veel te lang'],
  ['p2', 'GGZ wachtlijst echt veel te lang zeg'],
  ['p3', 'wachttijden bij de ggz blijven oplopen'],
  ['p4', 'het eten in de kantine is slecht'],          // a lone theme → below k
];
for (const [u, text] of contributions) await pod.write(u, buildContribution({ id: `${u}:1`, text }, { lang: 'nl' }));

const config = validateProjectConfig({ projectId: 'demo', llm: { route: 'local', model: 'mock' }, aggregation: { k: 3 } });
const aggregate = await aggregateForProject(await pod.forAggregation(), config, { skipClean: true });

const ws = createCuratorWorkspace({ aggregate, pod, reportId: 'demo-2026-Q2' });
console.log('--- DRAFT (what the curator sees) ---');
console.log(JSON.stringify(ws.review(), null, 2));

const { report, manifest } = await ws.release({ now: '2026-06-05T12:00:00Z' });
console.log('\n--- PUBLISHED REPORT ---\n');
console.log(renderReport(report, getStrings('nl')));
console.log('\nmanifest.includedContributionIds:', manifest.includedContributionIds);
console.log('pod statuses:', contributions.map(([u]) => `${u}:1=${pod.getStatus(`${u}:1`)}`).join('  '));

await mock.close();

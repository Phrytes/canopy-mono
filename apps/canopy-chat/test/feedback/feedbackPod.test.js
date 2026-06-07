// @vitest-environment node
// Tier-3c browser-auth wiring — activation → a flat CssCentralPod over the browser session
// fetch. Proven offline with a fake activation endpoint + a fake CSS session fetch.

import { test, expect } from 'vitest';
import { activateParticipant, buildFeedbackPod } from '../../src/feedback/feedbackPod.js';
import { buildContribution } from '../../../feedback-pipeline/src/pod/contribution.js';

function fakeCss() {
  const store = new Map(); const puts = [];
  const fetch = async (uri, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'PUT') { store.set(uri, init.body); puts.push(uri); return { ok: true, status: 201 }; }
    if (store.has(uri)) return { ok: true, status: 200, json: async () => JSON.parse(store.get(uri)), text: async () => store.get(uri) };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return { fetch, puts };
}

test('activateParticipant posts {projectId,code,webId} and returns podRef', async () => {
  let captured;
  const fetchImpl = async (url, init) => { captured = { url, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ ok: true, podRef: 'https://pods/p/central/p-x/' }) }; };
  const podRef = await activateParticipant({ activationUrl: 'https://activate.example/', projectId: 'proj', code: 'C-1', recoveryHash: 'rh', webId: 'https://pods/p#me', fetchImpl });
  expect(podRef).toBe('https://pods/p/central/p-x/');
  expect(captured.url).toBe('https://activate.example/activate');
  expect(captured.body).toMatchObject({ projectId: 'proj', code: 'C-1', recoveryHash: 'rh', webId: 'https://pods/p#me' });
});

test('activateParticipant surfaces the service reason on failure', async () => {
  const fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ ok: false, reason: 'code already used' }) });
  await expect(activateParticipant({ activationUrl: 'x', projectId: 'p', code: 'C', webId: 'w', fetchImpl }))
    .rejects.toThrow(/code already used/);
});

test('buildFeedbackPod activates, then writes the participant container via the session fetch', async () => {
  const css = fakeCss();
  const session = { webid: 'https://pods/p#me', fetch: css.fetch };
  const activation = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, podRef: 'https://pods/p/central/p-x/' }) });
  const pod = await buildFeedbackPod({ session, activationUrl: 'https://activate.example', projectId: 'proj', code: 'C', recoveryHash: 'rh', fetchImpl: activation });
  await pod.write('cc:thread-1', buildContribution({ id: 'cc:thread-1:1', text: 'de wachtlijst is te lang' }, { lang: 'nl' }));
  // flat: written straight into their own container (no extra <participant>/ segment)
  expect(css.puts).toEqual(['https://pods/p/central/p-x/cc%3Athread-1%3A1.json']);
});

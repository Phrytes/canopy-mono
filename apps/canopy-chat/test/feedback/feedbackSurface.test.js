// @vitest-environment node
// Integration test for hosting the feedback bot inside canopy-chat (M1.4 + M2). Proves the
// surface co-hosts the bot on a real InternalBus, drives the journey to the pod, SIGNS consent
// with the participant's identity (accepted by a verify pod), passes buttons through + handles
// taps, and parses a project-invite link. The bot OWNS the route (config.llm), no setLlmRoute.

import { test, expect, beforeAll, afterAll } from 'vitest';
import { startMockLlm } from '../../../feedback-pipeline/test/helpers/mock-llm.js';
import { InMemoryCentralPod } from '../../../feedback-pipeline/src/pod/central-pod.js';
import { InternalBus } from '@canopy/core';
import { generateParticipantIdentity, IdentityRoster, makeContributionVerifier } from '../../../feedback-pipeline/src/pod/signing.js';
import { createFeedbackSurface, parseFeedbackInvite, feedbackContactItem } from '../../src/feedback/feedbackSurface.js';

let mock;
beforeAll(async () => { mock = await startMockLlm(); });
afterAll(async () => { await mock.close(); });

const cfg = (extra = {}) => ({
  projectId: 'canopy-chat', llm: { route: 'local', model: 'mock', baseURL: mock.url }, aggregation: { k: 1 },
  signal: { layer1OnDevice: true, escalationCategories: ['crisis'] }, ...extra,
});

function setup(opts = {}) {
  const replies = [];
  const pod = opts.pod || new InMemoryCentralPod();
  const surface = createFeedbackSurface({ config: cfg(opts.configExtra), pod, emit: (r) => replies.push(r), ...opts.surface });
  return { surface, pod, replies };
}

test('free text is ignored until /feedback, then routed to the bot', async () => {
  const { surface, replies } = setup();
  expect(await surface.handle('De GGZ wachtlijst is te lang', 't1')).toBe(false);
  await surface.start('t1');
  expect(replies.at(-1).text).toMatch(/Zo werkt het/);
  replies.length = 0;
  expect(await surface.handle('De wachtlijst bij de GGZ is veel te lang', 't1')).toBe(true);
  expect(replies.at(-1).text).toMatch(/Ontvangen/);
});

test('full journey over the shared bus: message -> klaar -> verstuur alles -> pod', async () => {
  const { surface, pod, replies } = setup();
  await surface.start('a');
  await surface.handle('De wachtlijst bij de GGZ is al maanden veel te lang', 'a');
  replies.length = 0;
  await surface.handle('ik ben klaar', 'a');
  expect(replies.at(-1).buttons?.some((b) => b.id === 'fp:consent:all')).toBe(true);   // buttons pass through
  await surface.handle('verstuur alles', 'a');
  expect(pod.list().length).toBe(1);
  expect(pod.list()[0].participant).toBe('cc:a');
});

test('consent is SIGNED with the participant identity (accepted by a verify pod)', async () => {
  const id = generateParticipantIdentity();
  const roster = new IdentityRoster();
  roster.bind('cc:s', id.publicKey, id.encPublicKey);
  const pod = new InMemoryCentralPod({ verify: makeContributionVerifier({ roster, projectId: 'canopy-chat' }) });
  const replies = [];
  const surface = createFeedbackSurface({ config: cfg({ privacy: { verify: true } }), pod, identity: id, emit: (r) => replies.push(r) });

  await surface.start('s');
  await surface.handle('De GGZ-wachtlijst is veel te lang', 's');
  await surface.handle('ik ben klaar', 's');
  await surface.tapButton('fp:consent:all', 's');   // a button TAP drives consent
  expect(pod.forAggregation().length).toBe(1);        // signed → verified → aggregated
});

test('parseFeedbackInvite reads a project-invite link', () => {
  expect(parseFeedbackInvite('https://app.example/?projectId=gemeente-x&code=abc123')).toEqual({ projectId: 'gemeente-x', code: 'abc123' });
  expect(parseFeedbackInvite('projectId=p&code=c')).toEqual({ projectId: 'p', code: 'c' });
  expect(parseFeedbackInvite('https://app.example/?foo=bar')).toBe(null);
  expect(parseFeedbackInvite('')).toBe(null);
});

test('feedback threads stay isolated', async () => {
  const { surface, pod } = setup();
  await surface.start('x'); await surface.start('y');
  for (const tid of ['x', 'y']) {
    await surface.handle('GGZ wachtlijst te lang', tid);
    await surface.handle('klaar', tid);
    await surface.handle('verstuur alles', tid);
  }
  expect(new Set(pod.list().map((c) => c.participant))).toEqual(new Set(['cc:x', 'cc:y']));
});

test('feedbackContactItem — distinct agent contact (id matches bot address, openFeedback action)', () => {
  const item = feedbackContactItem({ label: 'Feedback assistant', openLabel: 'Open chat' });
  expect(item.id).toBe('fp-bot');          // matches the co-hosted bot address
  expect(item.type).toBe('agent');
  expect(item.kind).toBe('agent');
  expect(item.icon).toBeTruthy();
  expect(item.label).toBe('Feedback assistant');
  expect(item.buttons).toEqual([{ label: 'Open chat', callbackData: 'openFeedback:fp-bot' }]);
});

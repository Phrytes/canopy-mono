// @vitest-environment node
// Integration test for hosting the feedback bot inside canopy-chat. Proves the surface
// resolves + bundles the (browser-safe) feedback-pipeline bot under Vite, and that free
// text — only once a thread is in feedback mode — drives the full journey to the pod.

import { test, expect, beforeAll, afterAll } from 'vitest';
import { startMockLlm } from '../../../feedback-pipeline/test/helpers/mock-llm.js';
import { InMemoryCentralPod } from '../../../feedback-pipeline/src/pod/central-pod.js';
import { createFeedbackSurface } from '../../src/feedback/feedbackSurface.js';

let mock;
beforeAll(async () => { mock = await startMockLlm(); });
afterAll(async () => { await mock.close(); });

function setup() {
  const replies = [];
  const pod = new InMemoryCentralPod();
  const surface = createFeedbackSurface({
    config: { projectId: 'canopy-chat', llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 }, signal: { layer1OnDevice: true, escalationCategories: ['crisis'] } },
    pod, llmRoute: { baseURL: mock.url }, emit: (r) => replies.push(r),
  });
  return { surface, pod, replies };
}

test('free text is ignored until /feedback, then routed to the bot', async () => {
  const { surface, replies } = setup();
  expect(await surface.handle('De GGZ wachtlijst is te lang', 't1')).toBe(false);  // not in feedback mode
  await surface.start('t1');
  expect(replies.at(-1).text).toMatch(/Zo werkt het/);                              // greeting (/help)
  replies.length = 0;
  expect(await surface.handle('De wachtlijst bij de GGZ is veel te lang', 't1')).toBe(true);
  expect(replies.at(-1).text).toMatch(/Ontvangen/);
});

test('full journey: message -> klaar -> verstuur alles -> pod', async () => {
  const { surface, pod, replies } = setup();
  await surface.start('a');
  await surface.handle('De wachtlijst bij de GGZ is al maanden veel te lang', 'a');
  replies.length = 0;
  await surface.handle('ik ben klaar', 'a');
  expect(replies.at(-1).buttons?.some((b) => b.id === 'fp:consent:all')).toBe(true);
  await surface.handle('verstuur alles', 'a');
  expect(pod.list().length).toBe(1);
  expect(pod.list()[0].participant).toBe('cc:a');
});

test('feedback threads stay isolated', async () => {
  const { surface, pod } = setup();
  await surface.start('x'); await surface.start('y');
  for (const id of ['x', 'y']) {
    await surface.handle('GGZ wachtlijst te lang', id);
    await surface.handle('klaar', id);
    await surface.handle('verstuur alles', id);
  }
  expect(new Set(pod.list().map((c) => c.participant))).toEqual(new Set(['cc:x', 'cc:y']));
});

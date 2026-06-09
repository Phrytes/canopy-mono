// M3 — menu actions wired to own-pod ops: download (export own), delete (erase own), and
// pause/claim as optional pod capabilities (graceful when unsupported).
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryChannelAdapter } from '../src/channel/adapter.js';
import { ChannelDispatcher } from '../src/channel/dispatcher.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { buildContribution } from '../src/pod/contribution.js';
import { renderMessage } from '../src/channel/render.js';

const config = () => validateProjectConfig({ projectId: 'm3', llm: { route: 'local', model: 'm' }, aggregation: { k: 1 } });

function seeded() {
  const pod = new InMemoryCentralPod();
  pod.write('me', buildContribution({ id: 'me:1', text: 'wachtlijst te lang' }, { lang: 'nl' }));
  pod.write('me', buildContribution({ id: 'me:2', text: 'parkeren te duur' }, { lang: 'nl' }));
  pod.write('other', buildContribution({ id: 'other:1', text: 'iets anders' }, { lang: 'nl' }));
  const adapter = new MemoryChannelAdapter();
  return { pod, adapter, d: new ChannelDispatcher({ adapter, pod, config: config(), participant: 'me' }) };
}

test('download exports only the participant\'s own contributions', async () => {
  const { d, adapter } = seeded();
  const items = await d.command('download');
  assert.equal(items.length, 2);
  assert.ok(items.every((c) => c.id.startsWith('me:')));
  const msg = adapter.sent.at(-1);
  assert.equal(msg.type, 'download');
  assert.match(renderMessage(msg).text, /2 bijdrage/);          // default locale = nl
});

test('delete erases only the participant\'s own data', async () => {
  const { d, pod, adapter } = seeded();
  const n = await d.command('delete');
  assert.equal(n, 2);
  assert.equal(pod.list().filter((x) => x.participant === 'me').length, 0);
  assert.equal(pod.list().filter((x) => x.participant === 'other').length, 1);   // others untouched
  assert.match(renderMessage(adapter.sent.at(-1)).text, /2 bijdrage.*verwijderd/);
});

test('pause/claim use an optional pod capability; graceful when unsupported', async () => {
  const { d, adapter } = seeded();
  await d.command('pause');
  assert.equal(adapter.sent.at(-1).status, 'unsupported');
  assert.match(renderMessage(adapter.sent.at(-1)).text, /niet beschikbaar/);

  // a pod that DOES support pause
  const pod = new InMemoryCentralPod();
  let paused = false;
  pod.pause = (participant) => { paused = participant === 'me'; return true; };
  const adapter2 = new MemoryChannelAdapter();
  const d2 = new ChannelDispatcher({ adapter: adapter2, pod, config: config(), participant: 'me' });
  await d2.command('pause');
  assert.equal(paused, true);
  assert.equal(adapter2.sent.at(-1).ok, true);
  assert.match(renderMessage(adapter2.sent.at(-1)).text, /gepauzeerd/);
});

// PR-3 — two-way notify: pseudonymous store-and-forward, sealed to the participant via the
// roster (host-blind), the substrate adapter mapping, and release-triggered notification.
//   node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryNotifier, openNotification, createPodNotifier } from '../src/channel/notify.js';
import { IdentityRoster, generateParticipantIdentity } from '../src/pod/signing.js';

test('sealed notify: host stores ciphertext; only the participant opens it', () => {
  const roster = new IdentityRoster();
  const id = generateParticipantIdentity();
  roster.bind('pa', id.publicKey, id.encPublicKey);
  const notifier = new InMemoryNotifier({ roster });

  notifier.notify('pa', { type: 'report-released', payload: { reportId: 'r1', contributionIds: ['pa:1'] } });
  const [entry] = notifier.inbox('pa');
  assert.equal(entry.type, 'report-released');
  assert.ok(entry.sealed && !entry.payload, 'stored sealed, no plaintext payload');
  assert.ok(!JSON.stringify(entry).includes('pa:1'), 'ciphertext hides the content from the host');

  const opened = openNotification(entry, id.encPrivateKey);
  assert.deepEqual(opened.payload, { reportId: 'r1', contributionIds: ['pa:1'] });
});

test('unsealed notify when no enc key is registered (operational notice)', () => {
  const roster = new IdentityRoster();
  roster.bind('pa', generateParticipantIdentity().publicKey);   // signing only, no enc key
  const notifier = new InMemoryNotifier({ roster });
  notifier.notify('pa', { type: 'reminder', payload: { text: 'review pending' } });
  const [entry] = notifier.inbox('pa');
  assert.deepEqual(entry.payload, { text: 'review pending' });
  assert.ok(!entry.sealed);
});

test('inbox + ack: notifications clear once seen; persistence round-trips', () => {
  const notifier = new InMemoryNotifier();
  const a = notifier.notify('pa', { type: 't', payload: { n: 1 } });
  notifier.notify('pa', { type: 't', payload: { n: 2 } });
  assert.equal(notifier.inbox('pa').length, 2);
  notifier.ack('pa', [a]);
  assert.equal(notifier.inbox('pa').length, 1);

  const reloaded = InMemoryNotifier.fromJSON(JSON.parse(JSON.stringify(notifier.toJSON())));
  assert.equal(reloaded.inbox('pa').length, 1);
});

test('createPodNotifier maps notify() onto the substrate publish() (sealed, store-and-forward)', async () => {
  const roster = new IdentityRoster();
  const id = generateParticipantIdentity();
  roster.bind('pa', id.publicKey, id.encPublicKey);
  const published = [];
  const notifyEnvelope = { publish: async (args) => { published.push(args); return { mode: 'full-payload', queued: true }; } };
  const notifier = createPodNotifier({ notifyEnvelope, roster });

  const res = await notifier.notify('pa', { type: 'report-released', payload: { reportId: 'r1' } });
  assert.equal(res.mode, 'full-payload');
  assert.equal(published.length, 1);
  assert.equal(published[0].type, 'report-released');
  assert.deepEqual(published[0].recipients, ['pa']);
  assert.ok(published[0].payload.sealed, 'payload sealed to the participant');
  assert.deepEqual(openNotification(published[0].payload, id.encPrivateKey).payload, { reportId: 'r1' });
});

test('release() notifies each included participant pseudonymously (best-effort)', async () => {
  // a tiny pod stub + aggregate that includes one theme covering two participants' contributions
  const pod = {
    marked: null,
    async markIncluded(ids) { this.marked = ids; },
    async list() {
      return [
        { participant: 'pa', contribution: { id: 'pa:1', text: 'x' } },
        { participant: 'pb', contribution: { id: 'pb:1', text: 'y' } },
        { participant: 'pa', contribution: { id: 'pa:2', text: 'z' } },   // not in the report
      ];
    },
  };
  const aggregate = {
    statistical: [{ theme: 'wachttijden', userCount: 2, messageCount: 2, summary: 's', contributionIds: ['pa:1', 'pb:1'] }],
    review: [], signals: [], dropped: [], rejected: [], totalUsers: 2, totalMessages: 2, lang: 'nl', kThreshold: 1,
  };
  const notifier = new InMemoryNotifier();
  const { createCuratorWorkspace } = await import('../src/curator/workspace.js');
  const ws = createCuratorWorkspace({ aggregate, pod, reportId: 'r1', notifier });
  await ws.release({ now: '2026-06-07T00:00:00Z' });

  assert.deepEqual(pod.marked.sort(), ['pa:1', 'pb:1']);
  assert.deepEqual(notifier.inbox('pa').map((e) => e.payload.contributionIds), [['pa:1']]);  // only the released id
  assert.deepEqual(notifier.inbox('pb').map((e) => e.payload.contributionIds), [['pb:1']]);
});

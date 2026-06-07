// Tier-3c wiring — the channel surfaces using a REAL CssCentralPod, proven offline against a
// fake CSS fetch (the live path is the e2e/ACP smokes). Also the ACP `writers` role (the TG
// bot service writing on a participant's behalf).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { buildContribution } from '../src/pod/contribution.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { makeCssCentralPod } from '../src/pod/css-auth.js';
import { containerAcp } from '../src/pod/acp.js';
import { TelegramFeedbackBot } from '../src/channel/telegram-bot.js';

// a minimal in-memory stand-in for CSS over the fetch contract CssCentralPod uses
function fakeCss() {
  const store = new Map();
  const puts = [];
  const fetch = async (uri, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'PUT') { store.set(uri, init.body); puts.push(uri); return { ok: true, status: 201 }; }
    if (method === 'DELETE') { store.delete(uri); return { ok: true, status: 205 }; }
    if (store.has(uri)) return { ok: true, status: 200, json: async () => JSON.parse(store.get(uri)), text: async () => store.get(uri) };
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return { fetch, puts, store };
}

class FakeBridge {
  sent = []; #h;
  onMessage(h) { this.#h = h; }
  async sendReply(a) { this.sent.push(a); }
  async start() {} async stop() {}
  emit(m) { return this.#h(m); }
}

const config = () => validateProjectConfig({ projectId: 'w', llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 }, signal: { layer1OnDevice: true, escalationCategories: ['crisis'] } });

test('ACP writers role grants Write to the bot service (post-receipt channel)', () => {
  const ttl = containerAcp('https://pods.example/project/central/p1/', {
    participantWebId: 'https://pods.example/p1#me', ownerWebId: 'https://pods.example/owner#me',
    writers: ['https://svc.example/tg-bot#me'], readers: ['https://svc.example/agg#me'],
  });
  assert.match(ttl, /acp:agent <https:\/\/svc\.example\/tg-bot#me>/);     // writer matcher present
  assert.match(ttl, /acl:Read, acl:Write, acl:Append; acp:anyOf <#mW0>/); // writer gets Write
  assert.match(ttl, /<#pR0> a acp:Policy; acp:allow acl:Read; acp:anyOf <#mR0>/); // agg read-only
});

test('makeCssCentralPod writes to the per-participant container via an injected fetch', async () => {
  const css = fakeCss();
  const pod = await makeCssCentralPod({ podBase: 'https://pods.example/project/central/', authedFetch: css.fetch });
  const id = await pod.write('p-abc', buildContribution({ id: 'p-abc:1', text: 'hoi' }, { lang: 'nl' }));
  assert.equal(id, 'p-abc:1');
  assert.ok(css.puts.includes('https://pods.example/project/central/p-abc/p-abc%3A1.json'), css.puts.join());
});

test('TelegramFeedbackBot drives a real CssCentralPod (offline) end to end', async () => {
  const mock = await startMockLlm();
  process.env.FP_LLM_BASEURL = mock.url;
  const css = fakeCss();
  const pod = await makeCssCentralPod({ podBase: 'https://pods.example/project/central/', authedFetch: css.fetch });
  const bridge = new FakeBridge();
  const bot = new TelegramFeedbackBot({ bridge, pod, config: config() });
  await bot.start();
  await bridge.emit({ chatId: '77', messageId: '1', text: 'De GGZ wachtlijst is veel te lang' });
  await bridge.emit({ chatId: '77', messageId: '2', text: '/klaar' });
  await bridge.emit({ chatId: '77', messageId: '3', text: 'fp:consent:all' });
  assert.ok(css.puts.some((u) => u.includes('/central/tg%3A77/')), 'wrote to the participant container');
  await mock.close();
});

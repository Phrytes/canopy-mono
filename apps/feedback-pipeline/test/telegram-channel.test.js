// Telegram channel adapter + multiplexer bot — proves the real "post-receipt" surface
// drives the same dispatcher journey as canopy-chat, against a FAKE bridge (no @canopy
// dependency) + the mock LLM. The real TelegramBridge satisfies the same minimal
// onMessage/sendReply interface (exercised live by scripts/tg-bot-smoke.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { TelegramFeedbackBot } from '../src/channel/telegram-bot.js';
import { TelegramChannelAdapter, renderMessage } from '../src/channel/telegram-adapter.js';
import { getStrings } from '../src/strings/index.js';

class FakeBridge {
  sent = []; #handler;
  onMessage(h) { this.#handler = h; }
  async sendReply(a) { this.sent.push(a); }
  async start() {} async stop() {}
  emit(m) { return this.#handler(m); }
  last() { return this.sent.at(-1) || {}; }
  has(pred) { return this.sent.some(pred); }
  clear() { this.sent = []; }
}

const config = () => validateProjectConfig({
  projectId: 'tg', llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 },
  signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
});

test('renderMessage shapes the dispatcher messages (pure)', () => {
  assert.match(renderMessage({ type: 'received' }).text, /Ontvangen/);
  assert.match(renderMessage({ type: 'rejected', reason: 'te kort' }).text, /te kort/);
  const review = renderMessage({ type: 'review', points: [{ id: 'p1', text: 'punt een' }, { id: 'p2', text: 'punt twee' }] });
  assert.match(review.text, /punt een/);
  assert.ok(review.buttons.some((b) => b.id === 'fp:consent:p1'));
  assert.ok(review.buttons.some((b) => b.id === 'fp:consent:all'));
  const offer = renderMessage({ type: 'escalation-offer', category: 'crisis' });
  assert.ok(offer.buttons.some((b) => b.id === 'fp:escalate:yes'));
  assert.match(renderMessage({ type: 'submitted', ids: ['a', 'b'] }).text, /2 bijdrage/);
  assert.match(renderMessage({ type: 'review', points: [] }).text, /nog geen punten/);
});

test('adapter is post-receipt and floors in the bot service', () => {
  const a = new TelegramChannelAdapter({ bridge: new FakeBridge(), chatId: '1' });
  assert.equal(a.floorsTrust, 'post-receipt');
  const fm = a.floor('bel me op 06-12345678');
  assert.ok(fm.floored.includes('[') && !fm.floored.includes('12345678'));   // phone shielded
});

test('TG round trip: message -> review -> consent -> pod -> withdraw', async () => {
  const mock = await startMockLlm();
  process.env.FP_LLM_BASEURL = mock.url;
  const pod = new InMemoryCentralPod();
  const bridge = new FakeBridge();
  const bot = new TelegramFeedbackBot({ bridge, pod, config: config() });
  await bot.start();

  // 1. a feedback message -> floored, stored, "received"
  await bridge.emit({ chatId: '42', messageId: '1', text: 'De wachtlijst bij de GGZ is veel te lang.' });
  assert.match(bridge.last().text, /Ontvangen/);

  // 2. /klaar -> review with consent buttons
  bridge.clear();
  await bridge.emit({ chatId: '42', messageId: '2', text: '/klaar' });
  assert.ok(bridge.last().buttons.some((b) => b.id === 'fp:consent:all'), 'review offers consent buttons');

  // 3. consent all -> written to the pod, "submitted"
  bridge.clear();
  await bridge.emit({ chatId: '42', messageId: '3', text: 'fp:consent:all' });
  const mine = pod.list();
  assert.equal(mine.length, 1);
  assert.equal(mine[0].participant, 'tg:42');
  assert.match(bridge.last().text, /opgeslagen/);

  // 4. /mijn -> lists my contribution
  bridge.clear();
  await bridge.emit({ chatId: '42', messageId: '4', text: '/mijn' });
  assert.match(bridge.last().text, /bijdragen/);

  // 5. /intrekken <id> -> removed
  const id = mine[0].contribution.id;
  await bridge.emit({ chatId: '42', messageId: '5', text: `/intrekken ${id}` });
  assert.equal(pod.list().length, 0);

  await mock.close();
});

test('crisis message triggers the in-the-moment escalation offer', async () => {
  const mock = await startMockLlm();
  process.env.FP_LLM_BASEURL = mock.url;
  const bridge = new FakeBridge();
  const bot = new TelegramFeedbackBot({ bridge, pod: new InMemoryCentralPod(), config: config() });
  await bot.start();
  await bridge.emit({ chatId: '7', messageId: '1', text: 'ik zie het echt niet meer zitten' });
  assert.ok(bridge.has((m) => (m.buttons || []).some((b) => b.id === 'fp:escalate:yes')), 'offers to escalate');
  await mock.close();
});

test('strings are swappable by locale (no hardcoded prose)', () => {
  // same message, two locales → different prose, same structure
  const nl = renderMessage({ type: 'submitted', ids: ['a'] }, getStrings('nl'));
  const en = renderMessage({ type: 'submitted', ids: ['a'] }, getStrings('en'));
  assert.match(nl.text, /opgeslagen/);
  assert.match(en.text, /stored/);
  const enReview = renderMessage({ type: 'review', points: [{ id: 'p1', text: 'x' }] }, getStrings('en'));
  assert.equal(enReview.buttons.find((b) => b.id === 'fp:consent:all').label, 'Send all');
  assert.equal(getStrings('zz').received, getStrings('nl').received);   // unknown → default
});

test('bot responds in the project language (en)', async () => {
  const mock = await startMockLlm();
  process.env.FP_LLM_BASEURL = mock.url;
  const bridge = new FakeBridge();
  const enConfig = validateProjectConfig({
    projectId: 'tg-en', llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 },
    language: { preferred: 'en' }, signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
  });
  const bot = new TelegramFeedbackBot({ bridge, pod: new InMemoryCentralPod(), config: enConfig });
  await bot.start();
  await bridge.emit({ chatId: '9', messageId: '1', text: '/help' });
  assert.match(bridge.last().text, /How it works/);
  await bridge.emit({ chatId: '9', messageId: '2', text: 'GGZ waiting list far too long' });
  assert.match(bridge.last().text, /Received/);
  await mock.close();
});

test('two chats stay isolated (separate pseudonyms + sessions)', async () => {
  const mock = await startMockLlm();
  process.env.FP_LLM_BASEURL = mock.url;
  const pod = new InMemoryCentralPod();
  const bridge = new FakeBridge();
  const bot = new TelegramFeedbackBot({ bridge, pod, config: config() });
  await bot.start();
  for (const chatId of ['100', '200']) {
    await bridge.emit({ chatId, messageId: '1', text: 'GGZ wachtlijst te lang' });
    await bridge.emit({ chatId, messageId: '2', text: '/klaar' });
    await bridge.emit({ chatId, messageId: '3', text: 'fp:consent:all' });
  }
  const participants = new Set(pod.list().map((x) => x.participant));
  assert.deepEqual([...participants].sort(), ['tg:100', 'tg:200']);
  await mock.close();
});

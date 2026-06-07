// canopy-chat channel — the natural-language (pre-send) surface. Proves free-text input
// drives the same dispatcher journey as Telegram, via the intent classifier (deterministic
// fast-path + the mock LLM for the ambiguous rest). Fake bridge = the same minimal
// onMessage/sendReply contract the @canopy/chat-agent InMemoryBridge implements.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockLlm } from './helpers/mock-llm.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';
import { CanopyChatBot } from '../src/channel/canopy-chat-bot.js';
import { CanopyChatChannelAdapter } from '../src/channel/canopy-chat-adapter.js';
import { classifyIntent } from '../src/channel/intent.js';

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
  projectId: 'cc', llm: { route: 'local', model: 'mock' }, aggregation: { k: 1 },
  signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
});

test('adapter is pre-send and floors on the device', () => {
  const a = new CanopyChatChannelAdapter({ bridge: new FakeBridge(), chatId: '1' });
  assert.equal(a.floorsTrust, 'pre-send');
  const fm = a.floor('mijn 06-12345678 mag je hebben');
  assert.ok(fm.floored.includes('[') && !fm.floored.includes('12345678'));
});

test('intent classifier: deterministic fast-path (no model)', async () => {
  assert.equal((await classifyIntent('klaar')).kind, 'review');
  assert.equal((await classifyIntent('ik ben klaar')).kind, 'review');
  assert.deepEqual(await classifyIntent('verstuur alles'), { kind: 'consent', all: true });
  assert.equal((await classifyIntent('annuleer')).kind, 'cancel');
  // a feedback message that merely contains a keyword is NOT a command
  assert.equal((await classifyIntent('stop met dit beleid graag')).kind, 'message');
  assert.equal((await classifyIntent('de wachtlijst is veel te lang geworden')).kind, 'message');
});

test('intent classifier: LLM path for natural phrasing', async () => {
  const mock = await startMockLlm();
  process.env.FP_LLM_BASEURL = mock.url;
  // >6 words so the deterministic layer defers to the LLM
  const a = await classifyIntent('ja joh stuur die punten van mij maar allemaal door', { model: 'mock' });
  assert.deepEqual(a, { kind: 'consent', all: true });
  const b = await classifyIntent('volgens mij ben ik nu wel zo ongeveer klaar hoor', { model: 'mock' });
  assert.equal(b.kind, 'review');
  await mock.close();
});

test('NL round trip: free text -> "klaar" -> "verstuur alles" -> pod', async () => {
  const mock = await startMockLlm();
  process.env.FP_LLM_BASEURL = mock.url;
  const pod = new InMemoryCentralPod();
  const bridge = new FakeBridge();
  const bot = new CanopyChatBot({ bridge, pod, config: config() });
  await bot.start();

  await bridge.emit({ chatId: 'a', messageId: '1', text: 'De wachtlijst bij de GGZ is al maanden veel te lang.' });
  assert.match(bridge.last().text, /Ontvangen/);

  bridge.clear();
  await bridge.emit({ chatId: 'a', messageId: '2', text: 'oké volgens mij ben ik wel klaar zo' });
  assert.ok(bridge.last().buttons?.some((b) => b.id === 'fp:consent:all'), 'review shown');

  bridge.clear();
  await bridge.emit({ chatId: 'a', messageId: '3', text: 'ja stuur ze allemaal maar door' });
  assert.equal(pod.list().length, 1);
  assert.equal(pod.list()[0].participant, 'cc:a');
  assert.match(bridge.last().text, /opgeslagen/);
  await mock.close();
});

test('buttons still work alongside natural language', async () => {
  const mock = await startMockLlm();
  process.env.FP_LLM_BASEURL = mock.url;
  const pod = new InMemoryCentralPod();
  const bridge = new FakeBridge();
  const bot = new CanopyChatBot({ bridge, pod, config: config() });
  await bot.start();
  await bridge.emit({ chatId: 'b', messageId: '1', text: 'GGZ wachtlijst te lang' });
  await bridge.emit({ chatId: 'b', messageId: '2', text: 'fp:review' });       // button callback
  await bridge.emit({ chatId: 'b', messageId: '3', text: 'fp:consent:all' });   // button callback
  assert.equal(pod.list().length, 1);
  await mock.close();
});

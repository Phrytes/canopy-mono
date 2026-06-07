// canopy-chat smoke (Tier 2) — runs the natural-language feedback bot against the REAL
// @canopy/chat-agent InMemoryBridge, so we prove our CanopyChatBot satisfies the actual
// bridge contract (onMessage / sendReply / simulateIncoming + outbox), driving the same
// journey by free text: message -> "klaar" (review) -> "verstuur alles" (consent) -> pod.
//
//   FP_LLM_BASEURL=http://localhost:11434/v1 FP_LLM_MODEL=qwen2.5:7b \
//   node scripts/canopy-chat-smoke.js
//
// Skips cleanly (exit 0) if the chat-agent substrate isn't available. Needs an LLM route
// (FP_LLM_BASEURL or a local Ollama) for the review/clean step and richer NL phrasing; the
// deterministic intent fast-path ("klaar", "verstuur alles") works without one.

import { CanopyChatBot } from '../src/channel/canopy-chat-bot.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';

if (!process.env.FP_LLM_BASEURL) console.log('NOTE: FP_LLM_BASEURL not set — review/clean hits the default local route; use clear phrases.');

let InMemoryBridge;
try { ({ InMemoryBridge } = await import('../../../packages/chat-agent/src/bridges/InMemoryBridge.js')); }
catch (e) { console.log('SKIP: chat-agent substrate not available —', e.message); process.exit(0); }

const config = validateProjectConfig({
  projectId: 'cc-smoke',
  llm: { route: process.env.FP_LLM_ROUTE || 'local', model: process.env.FP_LLM_MODEL || 'qwen2.5:7b' },
  aggregation: { k: 3 },
  signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
});
const bridge = new InMemoryBridge({ id: 'canopy-chat' });
const pod = new InMemoryCentralPod();
const bot = new CanopyChatBot({ bridge, pod, config });
await bot.start();

const turns = [
  'De wachtlijst bij de GGZ is al maanden veel te lang.',
  'En de communicatie erover is ook slecht.',
  'oké volgens mij ben ik wel klaar',
  'ja stuur ze allemaal maar door',
];
for (const [i, text] of turns.entries()) {
  const before = bridge.outbox.length;
  await bridge.simulateIncoming({ chatId: 'demo', messageId: String(i + 1), text });
  console.log(`\n> ${text}`);
  for (const r of bridge.outbox.slice(before)) console.log(`  bot: ${r.text}${r.buttons ? `  [${r.buttons.map((b) => b.label).join(' | ')}]` : ''}`);
}
console.log(`\nstored ${pod.list().length} contribution(s):`, pod.list().map((x) => x.contribution.text));
await bot.stop();

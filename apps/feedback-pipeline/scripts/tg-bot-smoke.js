// Live Telegram smoke (Tier 2) — runs the feedback bot against the REAL
// @canopy/chat-agent TelegramBridge, so you can talk to it from Telegram and watch the
// whole journey: message -> floor (post-receipt, in this bot service) -> /klaar review ->
// consent buttons -> contribution written to the central pod.
//
//   FP_TG_BOT_TOKEN=123:ABC \
//   FP_LLM_BASEURL=http://localhost:11434/v1 FP_LLM_MODEL=qwen2.5:7b \
//   node scripts/tg-bot-smoke.js
//
// Skips cleanly (exit 0) if no token, or if the chat-agent substrate isn't available.
// The pod here is in-memory (a smoke); a real deployment passes a CssCentralPod +
// an HMAC participantFor so the pod never holds a reversible chat id.

import { TelegramFeedbackBot } from '../src/channel/telegram-bot.js';
import { InMemoryCentralPod } from '../src/pod/central-pod.js';
import { validateProjectConfig } from '../src/config/project-config.js';

const token = process.env.FP_TG_BOT_TOKEN || process.env.HOUSEHOLD_TG_BOT_TOKEN;
if (!token) { console.log('SKIP: set FP_TG_BOT_TOKEN (a Telegram bot token)'); process.exit(0); }
if (!process.env.FP_LLM_BASEURL) console.log('NOTE: FP_LLM_BASEURL not set — review/clean will hit the default local route.');

let TelegramBridge;
try { ({ TelegramBridge } = await import('../../../packages/chat-agent/src/bridges/TelegramBridge.js')); }
catch (e) { console.log('SKIP: chat-agent substrate not available —', e.message); process.exit(0); }

const config = validateProjectConfig({
  projectId: 'tg-smoke',
  llm: { route: process.env.FP_LLM_ROUTE || 'local', model: process.env.FP_LLM_MODEL || 'qwen2.5:7b' },
  aggregation: { k: 3 },
  signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
});
const bridge = new TelegramBridge({ botToken: token, mode: 'long-polling', dropPendingUpdates: true });

// Tier-3c: use a real CssCentralPod when pod credentials are present (the bot service writes
// on participants' behalf — provision their containers with FP_WRITER_WEBIDS=<bot webId>).
// Otherwise fall back to in-memory (a pure smoke).
let pod = new InMemoryCentralPod();
if (process.env.FP_PROJECT_POD && process.env.FP_BOT_CLIENT_ID && process.env.CSS_URL) {
  try {
    const { makeCssCentralPod } = await import('../src/pod/css-auth.js');
    pod = await makeCssCentralPod({
      podBase: `${process.env.FP_PROJECT_POD.replace(/\/$/, '')}/central/`,
      cssUrl: process.env.CSS_URL, clientId: process.env.FP_BOT_CLIENT_ID, clientSecret: process.env.FP_BOT_CLIENT_SECRET,
    });
    console.log('using CssCentralPod at', process.env.FP_PROJECT_POD);
  } catch (e) { console.log('CSS pod unavailable, using in-memory:', e.message); }
}
const bot = new TelegramFeedbackBot({ bridge, pod, config });

await bot.start();
console.log('feedback bot running (long-polling). DM it, then /klaar, then tap a consent button. Ctrl-C to stop.');
process.on('SIGINT', async () => { console.log(`\nstored ${(await pod.list()).length} contribution(s). stopping…`); await bot.stop(); process.exit(0); });

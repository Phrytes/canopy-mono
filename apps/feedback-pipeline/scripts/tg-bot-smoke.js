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
import { cryptoForProject } from '../src/pod/crypto-config.js';

const token = process.env.FP_TG_BOT_TOKEN || process.env.HOUSEHOLD_TG_BOT_TOKEN;
if (!token) { console.log('SKIP: set FP_TG_BOT_TOKEN (a Telegram bot token)'); process.exit(0); }
if (!process.env.FP_LLM_BASEURL) console.log('NOTE: FP_LLM_BASEURL not set — review/clean will hit the default local route.');

let TelegramBridge;
try { ({ TelegramBridge } = await import('../../../packages/chat-agent/src/bridges/TelegramBridge.js')); }
catch (e) { console.log('SKIP: chat-agent substrate not available —', e.message); process.exit(0); }

// Privacy is config-driven: set FP_PROJECT_PUBKEY to have the bot SEAL every contribution to
// the project key (the bot is a host-blind writer — it never holds the private key).
const config = validateProjectConfig({
  projectId: 'tg-smoke',
  llm: { route: process.env.FP_LLM_ROUTE || 'local', model: process.env.FP_LLM_MODEL || process.env.FP_MODEL || 'qwen2.5:7b' },
  aggregation: { k: 3 },
  signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
  ...(process.env.FP_PROJECT_PUBKEY ? { privacy: { seal: true, projectPublicKey: process.env.FP_PROJECT_PUBKEY } } : {}),
});
if (config.privacy.seal) console.log('sealing contributions to the project key (host-blind writer).');
const bridge = new TelegramBridge({ botToken: token, mode: 'long-polling', dropPendingUpdates: true });

// Tier-3c: real CSS pod when owner credentials are present. The TG bot service runs as the
// project-pod OWNER — it provisions each participant's ACP container on first contact
// (onActivate) and writes to it (post-receipt). Otherwise in-memory (a pure smoke).
let pod = new InMemoryCentralPod();
let onActivate;
if (process.env.CSS_URL && process.env.FP_OWNER_CLIENT_ID && process.env.FP_PROJECT_POD) {
  try {
    const { clientCredentialsFetch } = await import('../src/pod/css-auth.js');
    const { CssCentralPod } = await import('../src/pod/css-central-pod.js');
    const { provisionCssPod } = await import('../src/activation/provision-css-pod.js');
    const projectPodBase = process.env.FP_PROJECT_POD;
    const ownerWebId = process.env.FP_OWNER_WEBID;
    const ownerFetch = await clientCredentialsFetch({ cssUrl: process.env.CSS_URL, clientId: process.env.FP_OWNER_CLIENT_ID, clientSecret: process.env.FP_OWNER_CLIENT_SECRET });
    pod = new CssCentralPod({ authedFetch: ownerFetch, podBase: `${projectPodBase.replace(/\/$/, '')}/central/`, ...cryptoForProject({ config }) });
    // provision central/<participant>/ once per chat; owner is the writer (participantWebId = owner).
    onActivate = (participant) => provisionCssPod({ ownerFetch, projectPodBase, participant, participantWebId: ownerWebId, ownerWebId });
    console.log('using CssCentralPod + per-participant provisioning at', projectPodBase);
  } catch (e) { console.log('CSS pod unavailable, using in-memory:', e.message); }
}
const bot = new TelegramFeedbackBot({ bridge, pod, config, onActivate });

await bot.start();
console.log('feedback bot running (long-polling). DM it, then /klaar, then tap a consent button. Ctrl-C to stop.');
process.on('SIGINT', async () => { console.log(`\nstored ${(await pod.list()).length} contribution(s). stopping…`); await bot.stop(); process.exit(0); });

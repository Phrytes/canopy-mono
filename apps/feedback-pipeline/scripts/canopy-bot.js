#!/usr/bin/env node
// canopy-bot — the feedback bot as a co-hosted canopy contact (M1, local mode). Two things:
//
//  1. startLocalCanopyBot({ bus, pod, config, identityFor }) — the REUSABLE wiring the
//     canopy-chat web mount calls: an InternalBusBridge on the participant's shared bus + a
//     CanopyChatBot, signing consent with the participant's own key (identityFor). No network.
//
//  2. A runnable demo (when invoked directly): spins up its own InternalBus + a verify pod +
//     a scripted participant journey, with a SIGINT drain. Gated on an LLM route (review/intent
//     need one — set FP_LLM_BASEURL or run a local Ollama / loopback Privatemode proxy).
//
// External (peer/unsigned) mode lands in M5 (scripts gains a `--external` path over PeerBridge).

import { InternalBusBridge, connectFeedbackParticipant } from '../src/channel/internal-bus-bridge.js';
import { CanopyChatBot } from '../src/channel/canopy-chat-bot.js';
import { applyLlmRoute, assertCleanRouteSafe } from '../src/ollama.js';

/**
 * Wire + start a local (in-process) feedback bot on a shared InternalBus.
 * @param {{ bus, pod, config, identityFor?:Function, participantFor?:Function, botAddress?:string }} a
 * @returns {Promise<{ bridge:InternalBusBridge, bot:CanopyChatBot, stop:()=>Promise<void> }>}
 */
export async function startLocalCanopyBot({ bus, pod, config, identityFor, participantFor, botAddress = 'fp-bot' }) {
  if (!bus) throw new Error('startLocalCanopyBot: a shared InternalBus is required');
  // The bot owns its LLM route (M0): resolve from config, and refuse an unsafe clean route up
  // front so raw pre-consent text can never reach a plain remote host.
  applyLlmRoute(config.llm || {});
  assertCleanRouteSafe(config.llm || {});
  const bridge = new InternalBusBridge({ bus, address: botAddress });
  const bot = new CanopyChatBot({ bridge, pod, config, identityFor, participantFor });
  await bot.start();
  return { bridge, bot, stop: () => bot.stop() };
}

// ── runnable demo ─────────────────────────────────────────────────────────────────────────
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const log = (...a) => console.log(...a);
  const [{ InternalBus }, { InMemoryCentralPod }, { validateProjectConfig }, signing] = await Promise.all([
    import('../../../packages/core/src/transport/InternalTransport.js'),
    import('../src/pod/central-pod.js'),
    import('../src/config/project-config.js'),
    import('../src/pod/signing.js'),
  ]);

  const id = signing.generateParticipantIdentity();
  const roster = new signing.IdentityRoster();
  roster.bind('demo-participant', id.publicKey, id.encPublicKey);
  const pod = new InMemoryCentralPod({ verify: signing.makeContributionVerifier({ roster, projectId: 'canopy-bot-demo' }) });
  const config = validateProjectConfig({
    projectId: 'canopy-bot-demo',
    llm: { route: process.env.FP_LLM_ROUTE || 'local', model: process.env.FP_LLM_MODEL || 'mock' },
    aggregation: { k: 1 }, privacy: { verify: true },
    signal: { layer1OnDevice: true, escalationCategories: ['crisis'] },
  });

  const bus = new InternalBus();
  const { bot, stop } = await startLocalCanopyBot({ bus, pod, config, identityFor: () => id, participantFor: (c) => c });
  const me = connectFeedbackParticipant(bus, { chatId: 'demo-participant', onReply: (r) => log(`  bot: ${r.text}${r.buttons ? `  [${r.buttons.map((b) => b.id).join(' | ')}]` : ''}`) });
  process.on('SIGINT', async () => { log(`\nstored ${(await pod.list()).length} contribution(s). stopping…`); await stop(); process.exit(0); });

  const turns = ['De GGZ-wachtlijst is al maanden veel te lang.', 'oké volgens mij ben ik wel klaar', 'ja stuur ze allemaal maar door'];
  try {
    for (const text of turns) { log(`\n> ${text}`); await me.send(text); }
    const stored = await pod.list();
    log(`\n✓ ${stored.length} signed contribution(s) on the pod (co-hosted bot, no network).`);
    await stop();
    process.exit(stored.length ? 0 : 1);
  } catch (e) {
    log(`\nSKIP: the journey needs an LLM route for review/intent — set FP_LLM_BASEURL (or run Ollama / a loopback Privatemode proxy). (${e.message})`);
    await stop();
    process.exit(0);
  }
}

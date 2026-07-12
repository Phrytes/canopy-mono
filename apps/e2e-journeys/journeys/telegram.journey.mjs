// J-telegram: the Telegram on-ramp WITH PARITY (6a). The feedback app is built
// "once, two adapters": both canopy-chat and Telegram feed the SAME shared
// ChannelDispatcher → the SAME buildContribution → the SAME central-pod write. This
// journey drives BOTH channels with identical feedback and proves the contributions
// they land are EQUIVALENT — same validated shape, same cleaned text, pseudonymous —
// differing ONLY in the per-channel pseudonym. (The real central-pod CSS route is
// proven separately by J-feedback; this proves the CHANNEL parity.)
//
// SOFT-COUPLED: skips cleanly if @canopy-app/feedback-pipeline is absent (it is
// splitting to its own repo). Hermetic — no relay/pod (relayUrl unused).
import { checker } from './_util.mjs';

export const name = 'J-telegram (feedback on-ramp parity)';

// Same feedback, sent through each channel. A benign message (not floored/escalated).
const FEEDBACK = 'De wachtlijst bij de GGZ is veel te lang.';
// Irreversible pseudonyms (prod uses an HMAC of the chat id so the pod never holds a
// reversible id) — the point being the two channels differ ONLY by this label.
const TG_PARTICIPANT  = 'tg:9f2a7c11';
const APP_PARTICIPANT = 'cc:7b3e0d84';

export async function run() {
  let mods;
  try {
    mods = {
      ChannelDispatcher:      (await import('../../feedback-pipeline/src/channel/dispatcher.js')).ChannelDispatcher,
      MemoryChannelAdapter:   (await import('../../feedback-pipeline/src/channel/adapter.js')).MemoryChannelAdapter,
      TelegramChannelAdapter: (await import('../../feedback-pipeline/src/channel/telegram-adapter.js')).TelegramChannelAdapter,
      InMemoryCentralPod:     (await import('../../feedback-pipeline/src/pod/central-pod.js')).InMemoryCentralPod,
    };
  } catch (e) { return { skipped: true, reason: `feedback-pipeline unavailable (${(e?.message ?? '').slice(0, 48)})` }; }

  const { ChannelDispatcher, MemoryChannelAdapter, TelegramChannelAdapter, InMemoryCentralPod } = mods;
  const { results, check } = checker();
  const config = { projectId: 'parity', llm: { route: 'local', model: 'mock' }, aggregation: { k: 3 } };

  // ONE central pod both on-ramps write into.
  const central = new InMemoryCentralPod();

  // Run one channel's full participant flow: message → review → consent(write).
  const runChannel = async (adapter, participant) => {
    const d = new ChannelDispatcher({ adapter, pod: central, config, participant });
    await d.handleMessage(FEEDBACK);
    const points = await d.review();                 // 'mock' model → deterministic clean
    await d.consent(points.map((p) => p.id), { timeWindow: '2026' });
    return points;
  };

  // ── the TG on-ramp (post-receipt floor, on the bot service) ──────────────────
  const tgAdapter = new TelegramChannelAdapter({ bridge: { sendReply: async () => {} }, chatId: '12345' });
  const tgPoints = await runChannel(tgAdapter, TG_PARTICIPANT);
  check('the Telegram on-ramp accepts feedback and produces a point', tgPoints.length >= 1);

  // ── the app on-ramp (canopy-chat-style adapter) ──────────────────────────────
  const appPoints = await runChannel(new MemoryChannelAdapter(), APP_PARTICIPANT);
  check('the app on-ramp accepts the same feedback and produces a point', appPoints.length >= 1);

  // Both landed in the SAME central pod, one entry per channel.
  const entries = central.list();
  const tgEntry  = entries.find((e) => e.participant === TG_PARTICIPANT);
  const appEntry = entries.find((e) => e.participant === APP_PARTICIPANT);
  check('both channels wrote into the SAME central pod', !!tgEntry && !!appEntry && entries.length === 2);

  // ── PARITY: the contributions are equivalent, differing only by pseudonym ────
  const tgC = tgEntry?.contribution ?? {};
  const appC = appEntry?.contribution ?? {};
  check('parity: TG and app produce the SAME cleaned feedback text', tgC.text === appC.text && tgC.text === FEEDBACK);
  const shapeOf = (c) => JSON.stringify({ text: c.text, themeTags: c.themeTags ?? [], timeWindow: c.timeWindow, lang: c.lang });
  check('parity: identical validated contribution shape (id/pseudonym aside)', shapeOf(tgC) === shapeOf(appC));
  check('parity: only the pseudonym + id differ between the channels',
    tgEntry.participant !== appEntry.participant && tgC.id !== appC.id);

  // The bodies stay pseudonymous — no chat id / channel identity leaks into the contribution.
  const bodyBlob = JSON.stringify([tgC, appC]);
  check('both bodies are pseudonymous (no chat id / channel identity in the contribution)',
    !bodyBlob.includes('12345') && !/telegram|chatId/i.test(bodyBlob));

  // Both are aggregatable side by side (the summary job can't tell the on-ramp apart).
  const agg = central.forAggregation();
  check('aggregation treats both on-ramps identically (both summary-ready)',
    agg.length === 2 && agg.every((a) => a.text === FEEDBACK));

  return results;
}

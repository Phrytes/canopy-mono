// Feedback surface for canopy-chat — hosts the feedback-pipeline bot inside the chat shell.
// canopy-chat's free-text path is otherwise a dead end; when a thread is in FEEDBACK MODE
// (entered via /feedback), free text is routed to the bot, which runs the on-device floor +
// the same review/consent journey as Telegram.
//
// M1.4 — the bot is CO-HOSTED on the participant's shared @canopy/core InternalBus via the
// production InternalBusBridge (no network), and consent is SIGNED with the participant's own
// identity (so a verify-enabled project accepts it). The bot OWNS its LLM route (resolved from
// config.llm via the M0 guardrail — never a separate setLlmRoute here), so raw pre-consent text
// can only reach a safe (local/loopback/attested) model. DOM-free + testable: the host injects
// `emit(reply)` — the sink that renders a bot reply ({chatId, text, buttons}) into the thread.

import { InternalBus } from '@canopy/core';
// Single sanctioned import point into feedback (F1 boundary — the package `./public` barrel;
// relative until the F3 physical carve makes it a published-package specifier).
import {
  InternalBusBridge, connectFeedbackParticipant, CanopyChatBot, InMemoryCentralPod,
  validateProjectConfig, exampleProjectConfig, applyLlmRoute, assertCleanRouteSafe,
} from '../../../feedback-pipeline/src/public/index.js';
// Privacy-first logging (web ≡ mobile). PII-safe by construction — we log event CODES + scalar counts here,
// never message text, points, or identities. A dump handle is exposed so a bug report / debug can read it.
import { log, dumpLogs, formatLogs } from '@canopy/logger';

// One place both shells load, so the dump is retrievable on either without extra wiring. (A user-facing
// "Report a problem" screen that shows + sends this is the next logging slice.)
if (typeof globalThis !== 'undefined' && !globalThis.canopyDumpLogs) {
  globalThis.canopyLogs = dumpLogs;
  globalThis.canopyDumpLogs = () => formatLogs();
}

// "Report a problem" copy — the PII-safe framing + trigger labels, localised in-place. The feedback surface
// is outside the circle `t()` system (the bot owns its i18n via config.language); we mirror that here with a
// 2-language dict so both strings live ONCE, in shared code (web ≡ mobile by construction). The `intro`
// promises what the log CANNOT contain — the guarantee the logger enforces by construction (no message text,
// names, or addresses; only event codes + counts).
const REPORT_STRINGS = {
  nl: {
    header: '🛠 Probleem melden',
    intro:  'Hieronder staan technische notities van je apparaat. Ze bevatten géén berichten, namen of adressen — alleen gebeurteniscodes en aantallen. Bekijk ze en kopieer ze als je iets wilt melden.',
    empty:  '(nog niets vastgelegd)',
    hint:   'Werkt er iets niet?',
    button: '🛠 Probleem melden',
  },
  en: {
    header: '🛠 Report a problem',
    intro:  'Below are technical notes from your device. They contain no messages, names, or addresses — only event codes and counts. Review and copy them if you want to report something.',
    empty:  '(nothing recorded yet)',
    hint:   'Something not working?',
    button: '🛠 Report a problem',
  },
};

// Re-export so the app can create + CACHE the participant's own pod outside the surface — a language
// switch rebuilds the surface (fresh /help in the new language) while REUSING the same pods, so the
// participant's local Stage-1 contributions survive the switch (mirrors mobile FeedbackThreadScreen).
export { InMemoryCentralPod };

/**
 * @param {object} a
 * @param {object} [a.config]     a feedback ProjectConfig (defaults to the worked example). The
 *                                LLM route lives in `config.llm` (set config.llm.baseURL in the
 *                                browser — the bot owns the route).
 * @param {object} [a.pod]        a CentralPod (value/Promise/thunk); defaults to in-memory
 * @param {object} [a.bus]        the participant's shared InternalBus (defaults to a private one)
 * @param {{publicKey:string,sign:(b:Uint8Array)=>Uint8Array}} [a.identity]  the participant's SIGNER
 *                                (seam 4 — a `{publicKey, sign()}` closure from the canopy-chat vault;
 *                                consent is signed with it. A raw `{publicKey, privateKey}` keypair is
 *                                also accepted for standalone use. The signer is only wired to the bot
 *                                when the project requires signatures — see the `privacy.verify` gate below.)
 * @param {(chatId:string)=>object} [a.identityFor]  per-thread signer (defaults to `identity`)
 * @param {(reply:{chatId:string,text:string,buttons?:Array})=>void} a.emit  render sink
 */
export function createFeedbackSurface({ config, projectId, lang, pod, centralPod, controlStore, bus, identity, identityFor, llmBaseURL, llmModel, emit, verify, reportButton } = {}) {
  if (typeof emit !== 'function') throw new Error('createFeedbackSurface: emit(reply) is required');
  const cfg = validateProjectConfig(config || exampleProjectConfig);
  // the dispatcher's projectId drives the verify-round match; without an explicit config it defaults to
  // exampleProjectConfig.projectId, which won't equal the ACTIVATION projectId (the bot/cohort) — so the
  // verify poll filtered out the lead's round. Bind it to the activation project.
  if (projectId) cfg.projectId = projectId;
  // `lang` lets the PARTICIPANT choose the bot's language (overriding the project default) — it drives the
  // bot's strings + the on-device pipeline language (clean/summarise), so the whole thread + cards localise.
  if (lang === 'nl' || lang === 'en') cfg.language = { ...cfg.language, preferred: lang };
  // route ownership → the bot: the route lives in config.llm; `llmBaseURL`/`llmModel` are the browser's
  // no-env convenience to point config.llm at its (local/loopback) endpoint + the model that endpoint
  // actually serves (the default `qwen2.5:7b-instruct` 404s on a Privatemode proxy). Install + M0 check.
  if (llmBaseURL) cfg.llm.baseURL = llmBaseURL;
  if (llmModel) cfg.llm.model = llmModel;
  applyLlmRoute(cfg.llm || {});
  assertCleanRouteSafe(cfg.llm || {});

  const sharedBus = bus || new InternalBus();
  // Verify-summary loop: a background poll surfaces a round the PM opens WHILE the app is open. `relay`
  // wraps the caller's emit to notice when a verify bubble is shown (its buttons carry fp:verify*) so the
  // poll doesn't re-summarise (re-open) the same round every tick; a user turn clears the guard.
  let awaitingVerify = false;
  const relay = (r) => {
    const isVerify = Array.isArray(r?.buttons) && r.buttons.some((b) => String(b?.id || b?.action || '').startsWith('fp:verify'));
    if (isVerify) awaitingVerify = true;
    // PII-safe: log the reply KIND + button count — never the text/points. (This is exactly the trace that
    // would have shown, on mobile, that consent emitted nothing.)
    log.info('feedback', 'emit', { kind: r?.kind || (isVerify ? 'verify' : 'text'), btns: (r?.buttons || []).length });
    emit(r);
  };
  // "Report a problem": surface the PII-safe on-device log for the user to review (and copy) — the user-facing
  // half of the logging model. Emitted DIRECTLY (not via `relay`/the bot): it's a surface affordance, not a bot
  // reply, so it must not touch the verify re-poll guard. Localised to the bot's language. Same code both shells.
  const emitReport = (threadId) => {
    const S = REPORT_STRINGS[cfg.language?.preferred === 'nl' ? 'nl' : 'en'];
    const body = formatLogs();
    log.info('feedback', 'report.open', { n: dumpLogs().length });   // PII-safe: only the record COUNT
    emit({ chatId: String(threadId), kind: 'report', report: true, text: `${S.header}\n\n${S.intro}`, logText: body || S.empty, copyText: body });
  };

  // Consent-outcome probe (PII-safe): the own pod is the Stage-1 write target for the no-login flow, so its
  // record count before/after a consent turn tells us definitively whether the write LANDED — without touching
  // the read-only feedback-pipeline. Counts only; never contents. Returns -1 when the pod isn't syncly countable.
  const ownPodCount = async () => {
    try { const p = typeof pod === 'function' ? await pod() : await pod; return typeof p?.list === 'function' ? p.list().length : -1; }
    catch { return -1; }
  };

  const pollTimers = new Map();   // threadId -> interval handle
  // Seam 4 (F2): the signer is wired to the bot ONLY when the project requires signatures. For a
  // non-verify project (today's example) the signer stays INERT — behaviour is exactly as before F2
  // (unsigned writes, no signer object crosses into the bot). A verify-enabled project gets the
  // per-thread signer, which the dispatcher uses to sign consent contributions (never the raw key).
  // Slice 2 — the no-login central-pod route requires SIGNED contributions (the companion collector /
  // aggregation only accept signed records). `verify:true` turns on the signature path so `idFor` is
  // wired and the dispatcher signs each consented contribution with the participant's agent identity.
  if (verify) cfg.privacy = { ...(cfg.privacy || {}), verify: true };
  const idFor = cfg.privacy?.verify
    ? (identityFor || (identity ? () => identity : undefined))
    : undefined;

  // one co-hosted bot multiplexes all threads (keyed by chatId); pod resolved lazily so a real
  // CssCentralPod (built from the browser session after activation) can be supplied async.
  let botPromise = null;
  const bot = () => (botPromise ||= (async () => {
    const resolved = (typeof pod === 'function' ? await pod() : await pod) || new InMemoryCentralPod();
    // verify-summary loop (docs in apps/feedback-pipeline): when a central pod + a round-control store
    // are supplied, `pod` is the participant's OWN pod and the verified summary goes to `centralPod`.
    const resolvedCentral = typeof centralPod === 'function' ? await centralPod() : await centralPod;
    const bridge = new InternalBusBridge({ bus: sharedBus, address: 'fp-bot' });
    // The participant pseudonym IS the agent public key — the signature is computed over it, so the
    // central pod files + verifies under the same value (never a webid / device id). Falls back to the
    // default cc:<chatId> when no signer is wired (unsigned/legacy example flow).
    const participantFor = idFor ? (chatId) => idFor(chatId)?.publicKey || `cc:${chatId}` : undefined;
    const b = new CanopyChatBot({ bridge, pod: resolved, centralPod: resolvedCentral ?? null, controlStore: controlStore ?? null, config: cfg, identityFor: idFor, participantFor });
    await b.start();
    return b;
  })());

  const clients = new Map();   // threadId -> participant bus client
  const clientFor = async (threadId) => {
    await bot();   // ensure the bot is co-hosted before a participant connects
    const id = String(threadId);
    if (!clients.has(id)) clients.set(id, connectFeedbackParticipant(sharedBus, { botAddress: 'fp-bot', chatId: id, onReply: (r) => relay(r) }));
    return clients.get(id);
  };

  const active = new Set();
  return {
    /** Enter feedback mode for a thread and show the bot's guidance, then check for a lead-triggered
     *  verification round (the verify-summary loop polls on contact-open; no-op when not wired). */
    async start(threadId) {
      active.add(String(threadId));
      log.info('feedback', 'surface.start', { verify: !!controlStore, collector: !!centralPod });
      await (await clientFor(threadId)).send('/help');
      // Web offers the "Report a problem" trigger as a bubble-button (its idiom for feedback affordances, cf.
      // emitFeedbackLangOptions); mobile uses a header button and passes no `reportButton`. Either way the
      // tap/typed `/report` routes to `emitReport` below — the LOGIC is shared, only the trigger placement differs.
      if (reportButton) {
        const S = REPORT_STRINGS[cfg.language?.preferred === 'nl' ? 'nl' : 'en'];
        emit({ chatId: String(threadId), text: S.hint, buttons: [{ id: 'fp:report', label: S.button }] });
      }
      // poll the lead's /control/ round → on-device summary for verify. No open round is the normal case
      // (stay silent); surface only a genuine error so the user isn't left wondering.
      try { await (await bot()).pollVerification(String(threadId)); }
      catch (e) { emit({ chatId: String(threadId), text: `⚠ verify poll: ${e?.message ?? e}` }); }
      // Background poll — a round the PM opens LATER (while the app is open) appears on its own. Only when
      // the verify-summary loop is wired (a control store); skip while a verify bubble is already pending.
      if (controlStore && !pollTimers.has(String(threadId))) {
        pollTimers.set(String(threadId), setInterval(async () => {
          if (awaitingVerify || !active.has(String(threadId))) return;
          try { await (await bot()).pollVerification(String(threadId)); } catch { /* transient */ }
        }, 15000));
      }
    },
    /** Leave feedback mode. */
    stop(threadId) {
      active.delete(String(threadId));
      const tmr = pollTimers.get(String(threadId)); if (tmr) { clearInterval(tmr); pollTimers.delete(String(threadId)); }
      clients.get(String(threadId))?.close(); clients.delete(String(threadId));
    },
    isActive(threadId) { return active.has(String(threadId)); },
    /** Route a free-text turn to the bot IF the thread is in feedback mode. */
    async handle(text, threadId) {
      if (!active.has(String(threadId))) return false;
      // "Report a problem" is a SURFACE affordance, not a bot turn — intercept it here (typed `/report`/`/logs`/
      // `/problem`, or the `fp:report` button) so it never reaches the bot and never clears the verify guard.
      if (/^\s*(\/report|\/logs|\/problem|fp:report)\s*$/i.test(String(text || ''))) { emitReport(threadId); return true; }
      awaitingVerify = false;   // a user turn (incl. tapping a verify button) releases the re-poll guard
      // PII-safe: log whether the turn was a COMMAND (/… or fp:…) vs free text — never the text itself.
      log.info('feedback', 'turn', { cmd: /^(\/|fp:)/.test(String(text || '')) });
      // Consent-write probe: measure the own-pod record count around a consent turn so the log shows whether the
      // write landed (after > before), was a no-op re-review (after == before + a review emit), or errored.
      const isConsent = /^\s*fp:consent(:|$)/i.test(String(text || ''));
      const before = isConsent ? await ownPodCount() : 0;
      await (await clientFor(threadId)).send(text);
      if (isConsent) log.info('feedback', 'consent.turn', { before, after: await ownPodCount() });
      return true;
    },
    /** Show the "Report a problem" panel (PII-safe on-device log) — a shell can call this from a chrome button
     *  (mobile) instead of the typed `/report` / the `fp:report` bubble-button (web). */
    report(threadId) { if (active.has(String(threadId))) emitReport(threadId); },
    /** A button tap (M2): send the control id (fp:*) as a turn — the bot's parseControl handles it. */
    async tapButton(buttonId, threadId) {
      if (!active.has(String(threadId))) return false;
      awaitingVerify = false;
      await (await clientFor(threadId)).send(buttonId);
      return true;
    },
    /** Verify-summary push nudge — fire a local notification (`notify`) for any round this participant
     *  hasn't verified yet. Self-poll/self-notify; safe to call on app load/foreground. Returns the rounds
     *  nudged (for the caller to mark in `alreadyNudged`). No-op when the verify loop isn't wired. */
    async nudge(threadId, { notify, alreadyNudged } = {}) {
      try { return await (await bot()).nudge(String(threadId), { notify, alreadyNudged }); } catch { return []; }
    },
  };
}

/**
 * Parse a project-invite (M2). Accepts a full URL, a query string, or a URLSearchParams and
 * returns `{ projectId, code }` when both are present (the shape `inviteLink()` produces), else
 * null. Used to auto-run `/feedback <code>` when the app loads on an invite/QR link.
 */
export function parseFeedbackInvite(input) {
  let params;
  try {
    if (input instanceof URLSearchParams) params = input;
    else if (typeof input === 'string' && input.includes('?')) params = new URL(input, 'https://x.invalid').searchParams;
    else params = new URLSearchParams(input || '');
  } catch { return null; }
  const projectId = params.get('projectId');
  const code = params.get('code');
  return projectId && code ? { projectId, code } : null;
}

/**
 * Seam 4 (DECIDED 2026-07-08) — turn the host's core `AgentIdentity` into a SIGNER CLOSURE
 * `{ publicKey, sign(bytes) }` the feedback bot signs consent with. The private key stays
 * ENCAPSULATED in the identity: only `publicKey` + a `sign()` closure cross the seam, never the raw
 * key (the encapsulated-secret pattern, cf. `openerForIdentity` / `AgentIdentity.sharedCopyOpener`).
 * Feedback's `contributionMeta` accepts exactly this shape (`sign(bytes)` + `publicKey`). Returns null
 * when no identity is available (→ the surface wires no signer; a verify project then rejects, a
 * non-verify project is unaffected).
 *
 * @param {{pubKey?:string, sign?:(b:Uint8Array)=>Uint8Array}|null} identity  core AgentIdentity (e.g. `agent.sa.agent.identity`)
 * @returns {{publicKey:string, sign:(b:Uint8Array)=>Uint8Array}|null}
 */
export function signerForIdentity(identity) {
  if (!identity || typeof identity.sign !== 'function' || !identity.pubKey) return null;
  // Guard the sign call: a signing failure here (device crypto / key not available in the no-login path)
  // would otherwise throw from `contributionMeta` — which runs OUTSIDE the consent write's try/catch and is
  // then swallowed by the bus bridge's `try…finally` (no catch), so the write silently does nothing and no
  // reply is emitted. Log the error CLASS + short message (PII-safe: a crypto error carries no user data) so
  // the failure is visible in the report panel, then re-throw so the existing failure handling still runs.
  return {
    publicKey: identity.pubKey,
    sign: (bytes) => {
      try { return identity.sign(bytes); }
      catch (e) { log.error('feedback', 'sign.fail', { err: String(e?.name || 'Error'), msg: String(e?.message || '').slice(0, 40) }); throw e; }
    },
  };
}

/**
 * The feedback bot as a distinct **agent** contact item (M2). NOT a stoop mesh peer — a local
 * co-hosted assistant, surfaced in the contacts list with its own `kind:'agent'` + icon and an
 * action (`openFeedback`) that enters feedback mode rather than opening a peer DM. The chat shell
 * prepends this to the `/contacts` list and routes its button to feedback mode. Its `id` matches
 * the co-hosted bot address (`fp-bot`).
 *
 * @param {{label?:string, openLabel?:string}} [a]
 */
export function feedbackContactItem({ label = 'Feedback assistant', openLabel = 'Open chat' } = {}) {
  return {
    id:      'fp-bot',
    type:    'agent',
    kind:    'agent',
    icon:    '🤖',
    label,
    buttons: [{ label: openLabel, callbackData: 'openFeedback:fp-bot' }],
  };
}

/**
 * Split a long bubble into a preview HEAD + the REST at a natural boundary near `max`, so a big
 * verify-summary (or a long review point) can render with a "Show more" toggle instead of overflowing the
 * bubble. Shared web ≡ mobile so both shells chunk identically. `rest` is '' when the text fits within `max`
 * — the shells then render it as a plain bubble (no toggle).
 * @param {string} text
 * @param {number} [max=320]  soft length budget for the preview
 * @returns {{head:string, rest:string}}
 */
export function chunkBubble(text, max = 320) {
  const s = String(text ?? '');
  if (s.length <= max) return { head: s, rest: '' };
  const lo = Math.floor(max * 0.6);                 // don't cut earlier than 60% of the budget
  const slice = s.slice(0, max);
  // Prefer the latest natural boundary within [lo, max]: paragraph break > line break > sentence end > space.
  // Cut AFTER the delimiter (`+ len`) so the preview keeps the sentence/word intact and `rest` starts clean.
  const sentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
  const b = [
    { i: slice.lastIndexOf('\n\n'), len: 2 },
    { i: slice.lastIndexOf('\n'), len: 1 },
    { i: sentence, len: 2 },
    { i: slice.lastIndexOf(' '), len: 1 },
  ].find((x) => x.i >= lo);
  const at = b ? b.i + b.len : max;                 // no good boundary → hard cut at the budget
  return { head: s.slice(0, at).trimEnd(), rest: s.slice(at).trimStart() };
}

/** callbackData opId for a feedback action chip (M12). */
export const FEEDBACK_BUTTON_OP = 'fpTap';

/**
 * M12 — turn the bot's emitted buttons (`{id, label}`, the review/consent/escalate actions) into
 * INTERACTIVE chips instead of plain text bullets. Returns a one-row list payload (`{items}`) whose
 * buttons re-send the control id to the bot on tap. The control id (`fp:*`) contains colons, which the
 * shell's `opId:itemId` callbackData split would mangle — so it's URI-encoded here and decoded by
 * `decodeFeedbackButton` in the tap handler. Returns null when there are no buttons.
 */
export function feedbackButtonItems(buttons) {
  const list = (Array.isArray(buttons) ? buttons : []).filter((b) => b && b.id && b.label);
  if (list.length === 0) return null;
  return {
    items: [{
      id:      'fp-actions',
      label:   '',
      buttons: list.map((b) => ({ label: b.label, callbackData: `${FEEDBACK_BUTTON_OP}:${encodeURIComponent(b.id)}` })),
    }],
  };
}

/** Decode a feedback chip's `itemId` (URI-encoded control id) back to the bot control id. */
export function decodeFeedbackButton(itemId) {
  try { return decodeURIComponent(String(itemId ?? '')); } catch { return String(itemId ?? ''); }
}

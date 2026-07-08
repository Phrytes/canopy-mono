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
export function createFeedbackSurface({ config, projectId, lang, pod, centralPod, controlStore, bus, identity, identityFor, llmBaseURL, llmModel, emit } = {}) {
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
  // Seam 4 (F2): the signer is wired to the bot ONLY when the project requires signatures. For a
  // non-verify project (today's example) the signer stays INERT — behaviour is exactly as before F2
  // (unsigned writes, no signer object crosses into the bot). A verify-enabled project gets the
  // per-thread signer, which the dispatcher uses to sign consent contributions (never the raw key).
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
    const b = new CanopyChatBot({ bridge, pod: resolved, centralPod: resolvedCentral ?? null, controlStore: controlStore ?? null, config: cfg, identityFor: idFor });
    await b.start();
    return b;
  })());

  const clients = new Map();   // threadId -> participant bus client
  const clientFor = async (threadId) => {
    await bot();   // ensure the bot is co-hosted before a participant connects
    const id = String(threadId);
    if (!clients.has(id)) clients.set(id, connectFeedbackParticipant(sharedBus, { botAddress: 'fp-bot', chatId: id, onReply: (r) => emit(r) }));
    return clients.get(id);
  };

  const active = new Set();
  return {
    /** Enter feedback mode for a thread and show the bot's guidance, then check for a lead-triggered
     *  verification round (the verify-summary loop polls on contact-open; no-op when not wired). */
    async start(threadId) {
      active.add(String(threadId));
      await (await clientFor(threadId)).send('/help');
      // poll the lead's /control/ round → on-device summary for verify. No open round is the normal case
      // (stay silent); surface only a genuine error so the user isn't left wondering.
      try { await (await bot()).pollVerification(String(threadId)); }
      catch (e) { emit({ chatId: String(threadId), text: `⚠ verify poll: ${e?.message ?? e}` }); }
    },
    /** Leave feedback mode. */
    stop(threadId) { active.delete(String(threadId)); clients.get(String(threadId))?.close(); clients.delete(String(threadId)); },
    isActive(threadId) { return active.has(String(threadId)); },
    /** Route a free-text turn to the bot IF the thread is in feedback mode. */
    async handle(text, threadId) {
      if (!active.has(String(threadId))) return false;
      await (await clientFor(threadId)).send(text);
      return true;
    },
    /** A button tap (M2): send the control id (fp:*) as a turn — the bot's parseControl handles it. */
    async tapButton(buttonId, threadId) {
      if (!active.has(String(threadId))) return false;
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
  return { publicKey: identity.pubKey, sign: (bytes) => identity.sign(bytes) };
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

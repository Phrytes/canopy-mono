// The channel-agnostic dispatcher — the participant journey written ONCE, used by
// every channel through a ChannelAdapter (architecture §1.3 "build once, two
// adapters"; the journey is the user-stories doc). It uses the adapter only for I/O
// and floor placement; all logic here is identical across canopy-chat and TG.
//
// The dispatcher runs WHERE the channel processes a message — on the device for
// canopy-chat, in the bot service for TG — so the floor + clean it performs share the
// adapter's trust context.

import { assertAdapter } from './adapter.js';
import { escalates, runTask1, lineFor } from '../task1.js';
import { buildContribution } from '../pod/contribution.js';
import { configToRunOpts } from '../config/project-config.js';
import { contributionMeta } from '../pod/signing.js';
import { summariseOwnContributions, releaseVerifiedSummary } from '../verify/summary-round.js';

/** Deterministic 8-hex content hash (djb2-xor) — no deps, portable. Used to make a stored contribution id
 *  unique per distinct text across review rounds (positional p1/p2 ids alone collide). */
function contributionTextHash(text) {
  const s = String(text ?? '');
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export class ChannelDispatcher {
  #adapter; #pod; #participant; #opts; #projectId; #identity; #centralPod; #ownPod;
  #session = { messages: [], points: [], verifyDraft: null };

  /**
   * @param {{ adapter, pod, config, participant:string, identity?:{publicKey:string,privateKey:string} }} args
   *   adapter — a ChannelAdapter; pod — the central pod (Phase 2); participant — pseudonym.
   *   identity — the participant's OWN signing keypair, present only where the participant
   *     controls the agent (canopy-chat on-device). When set, contributions are SIGNED so a
   *     verify-enabled project accepts them. The host-run TG delegate has no participant key,
   *     so it writes unsigned — which a verify-enabled project will reject (TG is the
   *     lightweight, less-private option, by design).
   */
  #requiresSignature;

  constructor({ adapter, pod, config, participant, identity, centralPod, ownPod }) {
    this.#adapter = assertAdapter(adapter);
    this.#pod = pod;                        // Stage 1 target + the verify-round source. Own pod when verify-summary is wired.
    this.#participant = participant;
    this.#opts = configToRunOpts(config);
    this.#projectId = config?.projectId;
    this.#identity = identity;
    this.#requiresSignature = Boolean(config?.privacy?.verify);
    // Verify-summary loop (docs/DESIGN-verify-summary-loop.md): the CENTRAL pod receives ONLY the
    // user-verified summary. Optional — absent ⇒ the verify-turn is inert (legacy single-pod flows).
    this.#centralPod = centralPod ?? null;
    // Option C (host-run channel bots): a bot-held OWN pod that keeps the participant's RAW record
    // (bot-owned, TEE-protected), while `#pod` (central here) receives ONLY the raw-free contribution.
    // Optional — absent ⇒ raw is simply dropped (still never reaches central).
    this.#ownPod = ownPod ?? null;
  }

  #gate() { return { layer1OnDevice: this.#opts.layer1OnDevice, escalationCategories: this.#opts.escalationCategories }; }

  /** An inbound message. Floors via the adapter (placement), routes, responds. */
  async handleMessage(raw, { edited = false } = {}) {
    const fm = await this.#adapter.floor(raw, { userDefault: this.#opts.userDefault });
    if (fm.reject) {
      await this.#adapter.send({ type: 'rejected', reason: fm.reject });
      return { stored: false, reason: fm.reject };
    }
    this.#session.messages.push({ raw, fm, edited });

    // Layer-1 in-the-moment response (only when enabled + the category is on for this project)
    if (escalates(fm.signal, this.#gate())) {
      const support = this.#opts.passiveSupport?.[fm.signal.category];
      if (support) await this.#adapter.send({ type: 'support', resource: support });   // always-on, e.g. crisis → 113
      await this.#adapter.send({ type: 'escalation-offer', category: fm.signal.category });
    }
    await this.#adapter.send({ type: 'received' });
    return { stored: true, signal: fm.signal || null };
  }

  /** Curate the session's non-escalated messages into a reviewable list. PER-MESSAGE (1:1 with the raw)
   *  so the user can verify raw→curated, edit the curated text, and pick what to submit. Summarisation is
   *  the verify-summary stage's job (Stage 2), not contribute. `raw` rides along for the before/after view. */
  async review() {
    const msgs = this.#session.messages.filter((m) => !escalates(m.fm.signal, this.#gate()));
    const t1 = await runTask1(this.#opts.model, msgs.map((m) => m.raw), this.#opts);
    const points = t1.perMessage
      .filter((m) => !m.escalated)
      .map((m, i) => ({
        id: `p${i + 1}`, text: lineFor(m), raw: m.raw,
        ...(lineFor(m) !== m.raw ? { curated: true } : {}),
        // carry a channel-side edit flag back from the source message (matched by raw)
        ...(msgs.find((src) => src.raw === m.raw)?.edited ? { edited: true } : {}),
      }));
    this.#session.points = points;
    await this.#adapter.send({ type: 'review', points });
    return points;
  }

  /** Edit a reviewed point's curated text in place (the user's correction before consent). */
  editPoint(id, text) {
    const p = this.#session.points.find((x) => x.id === id);
    if (p && typeof text === 'string' && text.trim()) { p.text = text.trim(); p.edited = true; }
    return p;
  }

  /** Re-present the CURRENT reviewed points (after an edit) WITHOUT re-curating — re-running review()
   *  would re-clean from the raws and discard the user's edits. */
  async showReview() {
    await this.#adapter.send({ type: 'review', points: this.#session.points });
    return this.#session.points;
  }

  /** Consent: write the approved points to the central pod (the hand-over = the write). When
   *  the participant controls a signing identity, each contribution is signed (over plaintext)
   *  so a verify-enabled central pod accepts it.
   *
   *  Verification failures are surfaced GRACEFULLY, never thrown: if the project requires
   *  signatures but this channel has no participant key (the host-run TG delegate), nothing is
   *  attempted and the participant is told to use the canopy app; if an individual write is
   *  refused by the pod, the batch is rolled back (the partial writes withdrawn) and reported. */
  async consent(approvedIds, { timeWindow } = {}) {
    if (this.#requiresSignature && !this.#identity) {
      await this.#adapter.send({ type: 'verification-required' });
      return [];
    }
    const ids = new Set(approvedIds);
    const written = [];
    let failure = null;
    for (const p of this.#session.points) {
      if (!ids.has(p.id)) continue;
      // `p.id` (p1, p2…) is positional and restarts every review, so a later round's p1 would collide with
      // an already-stored p1 ('duplicate contribution id'). Suffix a content hash so the stored id is unique
      // per distinct text across rounds — while an exact-duplicate text still dedups (correct idempotency).
      const cid = `${this.#participant}:${p.id}-${contributionTextHash(p.text)}`;
      // raw is OWN-pod-only. `#pod` is the participant's own pod ONLY when a separate
      // `#centralPod` is wired (verify mode); when `#centralPod` is null, `#pod` IS the
      // central target (e.g. the host-run TG bot) → drop raw so it never reaches central.
      const keepRaw = Boolean(this.#centralPod);
      const contribution = buildContribution(
        { id: cid, text: p.text, raw: keepRaw ? p.raw : undefined, edited: p.edited },
        { timeWindow, lang: this.#opts.lang },
      );
      const meta = contributionMeta(this.#identity, { projectId: this.#projectId, participant: this.#participant, contribution });
      try {
        await this.#pod.write(this.#participant, contribution, meta);
        written.push(cid);
      } catch (e) { failure = e; console.error('[feedback] consent write failed:', e?.message); break; }   // a refused write means the batch is not trustworthy
      // Option C — keep the participant's OWN record (incl. raw) in the bot-held own pod. NON-FATAL:
      // the central contribution already succeeded; a failed own-pod record must not roll it back.
      if (this.#ownPod) {
        try {
          const ownRecord = buildContribution({ id: cid, text: p.text, raw: p.raw, edited: p.edited }, { timeWindow, lang: this.#opts.lang });
          await this.#ownPod.write(this.#participant, ownRecord);
        } catch (e) { console.error('[feedback] own-pod record failed (non-fatal):', e?.message); }
      }
    }
    if (failure) {
      // all-or-nothing: undo any partial writes so consent is not silently half-applied
      const attempted = written.length;
      for (const id of written) { try { await this.#pod.withdraw(this.#participant, id); } catch { /* best-effort */ } }
      await this.#adapter.send({ type: 'consent-failed', count: attempted || 1, reason: failure.message });
      return [];
    }
    await this.#adapter.send({ type: 'submitted', ids: written });
    // the reviewed batch is decided (consented or declined) — clear it so a second /klaar can't re-offer
    // and re-write the same points ("duplicate contribution id"). Escalated (signal-track) messages stay.
    this.#session.messages = this.#session.messages.filter((m) => escalates(m.fm.signal, this.#gate()));
    this.#session.points = [];
    return written;
  }

  // ── Verify-summary loop, Stage 2 (docs/DESIGN-verify-summary-loop.md) ─────────────────────────────
  // The lead opens a round → the bot summarises the participant's OWN pod ON-DEVICE → the participant
  // verifies / edits / withdraws → ONLY the verified summary is sealed+signed to the CENTRAL pod. The
  // raw never leaves the own pod.

  /** Open a verification round: summarise the OWN pod on-device, stash the draft, present it for verify. */
  async openVerificationRound({ round = 1, model = this.#opts.model, summarise = summariseOwnContributions } = {}) {
    const draft = await summarise({
      ownPod: this.#pod, participant: this.#participant, model,
      projectId: this.#projectId, round, opts: { lang: this.#opts.lang },
    });
    this.#session.verifyDraft = draft;
    await this.#adapter.send({ type: 'verify-summary', round, summary: draft.summary, points: draft.points });
    return draft;
  }

  /** Verify: release the (possibly edited) summary draft to the CENTRAL pod. The raw never leaves. */
  async verifySummary() {
    const draft = this.#session.verifyDraft;
    if (!draft) { await this.#adapter.send({ type: 'verify-none' }); return null; }
    if (this.#requiresSignature && !this.#identity) { await this.#adapter.send({ type: 'verification-required' }); return null; }
    if (!this.#centralPod) throw new Error('verifySummary: no centralPod configured');
    const cid = await releaseVerifiedSummary({
      centralPod: this.#centralPod, draft, identity: this.#identity,
      participant: this.#participant, lang: this.#opts.lang,
    });
    this.#session.verifyDraft = null;
    await this.#adapter.send({ type: 'verified', round: draft.round, id: cid });
    return cid;
  }

  /** Edit the pending summary (the participant rewords it), then re-present for verify. */
  async editVerificationSummary(newText) {
    if (!this.#session.verifyDraft) { await this.#adapter.send({ type: 'verify-none' }); return; }
    const summary = String(newText || '').trim();
    this.#session.verifyDraft = { ...this.#session.verifyDraft, summary, edited: true };
    await this.#adapter.send({ type: 'verify-summary', round: this.#session.verifyDraft.round, summary, points: this.#session.verifyDraft.points, edited: true });
  }

  /** Withdraw: discard the pending summary; nothing leaves the own pod. */
  async withdrawVerification() {
    this.#session.verifyDraft = null;
    await this.#adapter.send({ type: 'verification-withdrawn' });
  }

  /** The menu — identical across channels (architecture §1.3 button menu). */
  async command(action, arg) {
    switch (action) {
      case 'my-contributions': {
        const mine = (await this.#pod.list()).filter((x) => x.participant === this.#participant).map((x) => x.contribution);
        await this.#adapter.send({ type: 'contributions', items: mine });
        return mine;
      }
      case 'withdraw':
        await this.#pod.withdraw(this.#participant, arg);      // delete your own (before release)
        await this.#adapter.send({ type: 'withdrawn', id: arg });
        return true;
      case 'download': {                                       // export your own data (own-pod op)
        const mine = (await this.#pod.list()).filter((x) => x.participant === this.#participant).map((x) => x.contribution);
        await this.#adapter.send({ type: 'download', items: mine });
        return mine;
      }
      case 'delete': {                                          // erase all your own contributions
        const ids = (await this.#pod.list()).filter((x) => x.participant === this.#participant).map((x) => x.contribution.id);
        for (const id of ids) { try { await this.#pod.withdraw(this.#participant, id); } catch { /* best-effort */ } }
        await this.#adapter.send({ type: 'delete', count: ids.length });
        return ids.length;
      }
      // pause/claim are pod-lifecycle ops (pause participation; claim a project-provisioned pod
      // to your identity). Available only when the participant pod implements them — otherwise a
      // graceful "not supported by this pod" rather than a dead 'todo'.
      case 'pause': case 'claim': {
        const fn = this.#pod[action];
        if (typeof fn === 'function') { const r = await fn.call(this.#pod, this.#participant, this.#identity); await this.#adapter.send({ type: action, ok: true }); return r; }
        await this.#adapter.send({ type: action, status: 'unsupported' });
        return false;
      }
      // verify-summary round (Stage 2) — button taps from the verify-summary bubble
      case 'verify':          return this.verifySummary();
      case 'verify-edit':     return this.editVerificationSummary(arg);
      case 'verify-withdraw': return this.withdrawVerification();
      default:
        throw new Error(`unknown action: ${action}`);
    }
  }
}

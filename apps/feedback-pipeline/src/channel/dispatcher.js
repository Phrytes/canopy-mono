// The channel-agnostic dispatcher — the participant journey written ONCE, used by
// every channel through a ChannelAdapter (architecture §1.3 "build once, two
// adapters"; the journey is the user-stories doc). It uses the adapter only for I/O
// and floor placement; all logic here is identical across canopy-chat and TG.
//
// The dispatcher runs WHERE the channel processes a message — on the device for
// canopy-chat, in the bot service for TG — so the floor + clean it performs share the
// adapter's trust context.

import { assertAdapter } from './adapter.js';
import { escalates, runTask1 } from '../task1.js';
import { buildContribution } from '../pod/contribution.js';
import { configToRunOpts } from '../config/project-config.js';
import { signContribution } from '../pod/signing.js';

export class ChannelDispatcher {
  #adapter; #pod; #participant; #opts; #projectId; #identity;
  #session = { messages: [], points: [] };

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

  constructor({ adapter, pod, config, participant, identity }) {
    this.#adapter = assertAdapter(adapter);
    this.#pod = pod;
    this.#participant = participant;
    this.#opts = configToRunOpts(config);
    this.#projectId = config?.projectId;
    this.#identity = identity;
    this.#requiresSignature = Boolean(config?.privacy?.verify);
  }

  #gate() { return { layer1OnDevice: this.#opts.layer1OnDevice, escalationCategories: this.#opts.escalationCategories }; }

  /** An inbound message. Floors via the adapter (placement), routes, responds. */
  async handleMessage(raw) {
    const fm = await this.#adapter.floor(raw, { userDefault: this.#opts.userDefault });
    if (fm.reject) {
      await this.#adapter.send({ type: 'rejected', reason: fm.reject });
      return { stored: false, reason: fm.reject };
    }
    this.#session.messages.push({ raw, fm });

    // Layer-1 in-the-moment response (only when enabled + the category is on for this project)
    if (escalates(fm.signal, this.#gate())) {
      const support = this.#opts.passiveSupport?.[fm.signal.category];
      if (support) await this.#adapter.send({ type: 'support', resource: support });   // always-on, e.g. crisis → 113
      await this.#adapter.send({ type: 'escalation-offer', category: fm.signal.category });
    }
    await this.#adapter.send({ type: 'received' });
    return { stored: true, signal: fm.signal || null };
  }

  /** Dedup the session's non-escalated messages into a reviewable point list. */
  async review() {
    const raws = this.#session.messages.filter((m) => !escalates(m.fm.signal, this.#gate())).map((m) => m.raw);
    const t1 = await runTask1(this.#opts.model, raws, this.#opts);
    this.#session.points = t1.points;
    await this.#adapter.send({ type: 'review', points: t1.points });
    return t1.points;
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
      const cid = `${this.#participant}:${p.id}`;
      const contribution = buildContribution({ id: cid, text: p.text }, { timeWindow, lang: this.#opts.lang });
      const meta = this.#identity
        ? { sig: signContribution({ projectId: this.#projectId, participant: this.#participant, contribution }, this.#identity.privateKey), pubKey: this.#identity.publicKey }
        : {};
      try {
        await this.#pod.write(this.#participant, contribution, meta);
        written.push(cid);
      } catch (e) { failure = e; break; }   // a refused write means the batch is not trustworthy
    }
    if (failure) {
      // all-or-nothing: undo any partial writes so consent is not silently half-applied
      const attempted = written.length;
      for (const id of written) { try { await this.#pod.withdraw(this.#participant, id); } catch { /* best-effort */ } }
      await this.#adapter.send({ type: 'consent-failed', count: attempted || 1, reason: failure.message });
      return [];
    }
    await this.#adapter.send({ type: 'submitted', ids: written });
    return written;
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
      // seams onto the own-pod / vault / exit flow (substrate, later phases):
      case 'download': case 'claim': case 'pause': case 'delete':
        await this.#adapter.send({ type: action, status: 'todo' });
        return false;
      default:
        throw new Error(`unknown action: ${action}`);
    }
  }
}

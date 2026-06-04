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

export class ChannelDispatcher {
  #adapter; #pod; #participant; #opts;
  #session = { messages: [], points: [] };

  /**
   * @param {{ adapter, pod, config, participant:string }} args
   *   adapter — a ChannelAdapter; pod — the central pod (Phase 2); participant — pseudonym.
   */
  constructor({ adapter, pod, config, participant }) {
    this.#adapter = assertAdapter(adapter);
    this.#pod = pod;
    this.#participant = participant;
    this.#opts = configToRunOpts(config);
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

  /** Consent: write the approved points to the central pod (the hand-over = the write). */
  async consent(approvedIds, { timeWindow } = {}) {
    const ids = new Set(approvedIds);
    const written = [];
    for (const p of this.#session.points) {
      if (!ids.has(p.id)) continue;
      const cid = `${this.#participant}:${p.id}`;
      this.#pod.write(this.#participant, buildContribution({ id: cid, text: p.text }, { timeWindow, lang: this.#opts.lang }));
      written.push(cid);
    }
    await this.#adapter.send({ type: 'submitted', ids: written });
    return written;
  }

  /** The menu — identical across channels (architecture §1.3 button menu). */
  async command(action, arg) {
    switch (action) {
      case 'my-contributions': {
        const mine = this.#pod.list().filter((x) => x.participant === this.#participant).map((x) => x.contribution);
        await this.#adapter.send({ type: 'contributions', items: mine });
        return mine;
      }
      case 'withdraw':
        this.#pod.withdraw(this.#participant, arg);            // delete your own (before release)
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

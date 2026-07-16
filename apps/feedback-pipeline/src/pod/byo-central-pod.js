// ByoCentralPod — bring-your-own-pod aggregation (PR-4). The contributions live on each
// participant's OWN pod / agent; the central side never holds a copy of the raw or even the
// container. It only needs them sealed-to-project + signed by a verified member — so this
// backend reads N participant "sources", opens (project key) + verifies (roster) each, drops
// anything unverified, and presents the SAME read interface (list / forAggregation) as the
// other central pods. It is the concrete answer to "bring your own pod, as long as the
// participant can verify itself" — the verification layer (PR-3) is the enabler.
//
// A source is { participant, read: async () => StoredRecord[] }, where StoredRecord is exactly
// what gets written to any central pod: { contribution:{id,text,...}, sig, pubKey } with text
// sealed when the project seals. The participant's agent produces these from their own pod (it
// holds the project PUBLIC key to seal and its own key to sign). Writes/withdrawals happen on
// the participant's pod via their agent — not here — so this backend is read-oriented.

import { isSealed } from './project-seal.js';
import { assertCentralPod } from './central-pod-interface.js';

export class ByoCentralPod {
  #sources = new Map();   // participant -> read()
  #open; #verify;
  #included = new Set();  // release registry — ids marked included at curator release. Central-
                          // side bookkeeping ONLY (no raw): records WHICH contributions were
                          // released, so the curator can mark + notify without holding a copy.

  /** @param {{ sources?: Array<{participant:string, read:Function}>, open?:Function, verify?:Function }} a
   *   open — opener for sealed text (the keyless aggregation job holds it); verify — the
   *   contribution verifier (authenticity + roster membership). Both optional, but a BYO
   *   deployment should run with verify ON: it is the only thing that makes an unknown,
   *   self-hosted source trustworthy. */
  constructor({ sources = [], open, verify } = {}) {
    this.#open = open;
    this.#verify = verify;
    for (const s of sources) this.addSource(s);
  }

  /** Register a participant's own pod as a source. */
  addSource({ participant, read }) {
    if (!participant || typeof read !== 'function') throw new Error('ByoCentralPod: source needs { participant, read() }');
    this.#sources.set(participant, read);
    return this;
  }

  async #records() {
    const out = [];
    for (const [participant, read] of this.#sources) {
      let recs;
      try { recs = await read(); } catch { recs = []; }   // an unreachable BYO pod just contributes nothing
      for (const r of recs || []) out.push({ participant, ...r });
    }
    return out;
  }

  // open (if sealed) + verify against the registered key; null → drop from the aggregate.
  #revealVerified(rec) {
    let contribution = rec.contribution;
    if (isSealed(contribution.text)) {
      if (!this.#open) throw new Error('contribution is sealed and no opener is configured (locked)');
      contribution = { ...contribution, text: this.#open(contribution.text) };
    }
    if (this.#verify) {
      try { this.#verify(rec.participant, contribution, { sig: rec.sig, pubKey: rec.pubKey }); }
      catch { return null; }
    }
    return contribution;
  }

  async list() {
    return (await this.#records())
      .map((r) => ({ participant: r.participant, contribution: this.#revealVerified(r) }))
      .filter((e) => e.contribution !== null);
  }

  async forAggregation() {
    return (await this.#records())
      .map((r) => { const c = this.#revealVerified(r); return c && { user: r.participant, id: c.id, text: c.text, lang: c.lang, ...(c.attributes ? { attributes: c.attributes } : {}), ...(c.charterHash ? { charterHash: c.charterHash } : {}) }; })
      .filter(Boolean);
  }

  /** Curator release bookkeeping — mark contributions included. The raw stays on the participant
   *  pods; this only records the released ids centrally (for status + notify). */
  markIncluded(ids) { for (const id of ids || []) this.#included.add(String(id)); }
  getStatus(id) { return this.#included.has(String(id)) ? 'included' : 'pending'; }
}

// ByoCentralPod satisfies the read subset of the CentralPod contract.
export const BYO_READ_METHODS = ['list', 'forAggregation'];
export const assertByoReadable = (pod) => assertCentralPod(pod, BYO_READ_METHODS);

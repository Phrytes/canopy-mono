// The central project pod (build proposal §1.4): one pod per project; each
// participant has a pseudonymous container with WRITE + DELETE rights for THEMSELVES
// only. Consent = the write action (whatever is here was deliberately handed over);
// withdrawing before release = deleting your own contribution. The aggregation job
// reads ONLY this pod.
//
// This is an in-memory implementation of the CentralPod interface for tests + dev. A
// real CSS / pod-client adapter implements the same interface later (Phase 4); the
// "participant-only" ACL is enforced by CSS there and modelled by the `participant`
// argument here.

import { validateContribution } from './contribution.js';
import { isSealed } from './project-seal.js';

export const STATUSES = ['submitted', 'included', 'withdrawn'];

/** Withdrawal is only possible BEFORE a contribution is released in a report. */
export function canWithdraw(status) { return status === 'submitted'; }

export class InMemoryCentralPod {
  #containers = new Map();   // participant -> Contribution[]
  #status = new Map();       // contributionId -> status
  #meta = new Map();         // contributionId -> { sig, pubKey }
  #seal; #open; #verify;

  // Optional at-rest sealing (default off → unchanged behaviour). `seal` needs only the
  // project public key (host-blind writer); `open` holds a private key (the keyless
  // aggregation job, after it unwraps). Identity (the pseudonym / container) and the id
  // stay cleartext — only the contribution TEXT is sealed (the metadata gap is noted in
  // the plan; sealing the whole body is a later mitigation).
  //
  // Optional `verify` (from signing.js makeContributionVerifier) enforces authenticity +
  // one-code→one-identity: it gates write() for honest clients, and — the real boundary —
  // re-checks stored signatures at the aggregation read, DROPPING anything that fails (so a
  // malicious writer who bypasses write() still cannot get an injected/sybil contribution
  // into the aggregate). Default off → unchanged behaviour.
  constructor({ seal, open, verify } = {}) { this.#seal = seal; this.#open = open; this.#verify = verify; }

  // Reveal stored content at a text boundary: open if a sealed contribution is read while
  // an opener is configured; throw if sealed but locked (this is how "no aggregation
  // without unlock" is enforced). Status/withdraw paths never go through here.
  #reveal(c) {
    if (!isSealed(c.text)) return c;
    if (!this.#open) throw new Error('contribution is sealed and no opener is configured (locked)');
    return { ...c, text: this.#open(c.text) };
  }

  /** Write (the consent action). Validates defensively — the central side of the
   *  two-layer check. When a verifier is configured the contribution must be signed by the
   *  participant's registered key. Returns the contribution id. */
  write(participant, raw, meta = {}) {
    const c = validateContribution(raw);
    if (this.#status.has(c.id)) throw new Error(`duplicate contribution id: ${c.id}`);
    if (this.#verify) this.#verify(participant, c, meta);     // honest-client gate (over plaintext)
    const stored = this.#seal ? { ...c, text: this.#seal(c.text) } : c;
    if (!this.#containers.has(participant)) this.#containers.set(participant, []);
    this.#containers.get(participant).push(stored);
    this.#status.set(c.id, 'submitted');
    if (this.#verify) this.#meta.set(c.id, { sig: meta.sig, pubKey: meta.pubKey });
    return c.id;
  }

  /** Withdraw your own contribution — allowed only before release. */
  withdraw(participant, contributionId) {
    const arr = this.#containers.get(participant) || [];
    const i = arr.findIndex((c) => c.id === contributionId);
    if (i < 0) throw new Error('not found in your container');
    const status = this.#status.get(contributionId);
    if (!canWithdraw(status)) throw new Error(`cannot withdraw (status=${status})`);
    arr.splice(i, 1);
    this.#status.set(contributionId, 'withdrawn');
  }

  /** Mark contributions as included in a released report (terminal; blocks withdrawal). */
  markIncluded(ids) {
    for (const id of ids) if (this.#status.get(id) === 'submitted') this.#status.set(id, 'included');
  }

  getStatus(id) { return this.#status.get(id) || null; }

  // Open + (if a verifier is configured) re-check the signature against the registered key,
  // dropping contributions that fail — the aggregation-boundary authenticity gate.
  #revealVerified(participant, stored) {
    const contribution = this.#reveal(stored);
    if (this.#verify) {
      try { this.#verify(participant, contribution, this.#meta.get(contribution.id) || {}); }
      catch { return null; }   // unsigned / forged / sybil → excluded from the aggregate
    }
    return contribution;
  }

  /** All current (verified) contributions with their participant pseudonym (for k-anon
   *  counting). Reveals sealed content (throws if locked) — a text boundary. */
  list() {
    return [...this.#containers.entries()].flatMap(([participant, cs]) =>
      cs.map((stored) => ({ participant, contribution: this.#revealVerified(participant, stored) }))
        .filter((e) => e.contribution !== null));
  }

  /** Shape the contributions for the Task-2 aggregation ({user, text, lang}). The
   *  aggregation should run with `{ skipClean: true }` — these are already cleaned and
   *  CONSENTED, and must not be re-edited. */
  forAggregation() {
    return this.list().map(({ participant, contribution }) => ({
      user: participant, id: contribution.id, text: contribution.text, lang: contribution.lang,
      // Property layer — carry the disclosed coarse attributes + charterHash ALONGSIDE the text so the
      // aggregation can attributeK-suppress rare segments. Absent when the contribution disclosed nothing.
      ...(contribution.attributes ? { attributes: contribution.attributes } : {}),
      ...(contribution.charterHash ? { charterHash: contribution.charterHash } : {}),
    }));
  }
}

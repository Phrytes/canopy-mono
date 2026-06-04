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

export const STATUSES = ['submitted', 'included', 'withdrawn'];

/** Withdrawal is only possible BEFORE a contribution is released in a report. */
export function canWithdraw(status) { return status === 'submitted'; }

export class InMemoryCentralPod {
  #containers = new Map();   // participant -> Contribution[]
  #status = new Map();       // contributionId -> status

  /** Write (the consent action). Validates defensively — the central side of the
   *  two-layer check. Returns the contribution id. */
  write(participant, raw) {
    const c = validateContribution(raw);
    if (this.#status.has(c.id)) throw new Error(`duplicate contribution id: ${c.id}`);
    if (!this.#containers.has(participant)) this.#containers.set(participant, []);
    this.#containers.get(participant).push(c);
    this.#status.set(c.id, 'submitted');
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

  /** All current contributions with their participant pseudonym (for k-anon counting). */
  list() {
    return [...this.#containers.entries()]
      .flatMap(([participant, cs]) => cs.map((contribution) => ({ participant, contribution })));
  }

  /** Shape the contributions for the Task-2 aggregation ({user, text, lang}). The
   *  aggregation should run with `{ skipClean: true }` — these are already cleaned and
   *  CONSENTED, and must not be re-edited. */
  forAggregation() {
    return this.list().map(({ participant, contribution }) => ({
      user: participant, text: contribution.text, lang: contribution.lang,
    }));
  }
}

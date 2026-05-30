/**
 * canopy-chat v2 — proposal store for multi-admin consensus (P6.2).
 *
 * `makeProposal()` (circleConsensus.js) builds the in-memory shape; this
 * store is the persistence layer the host wires on top.  Same IO contract
 * as createCirclePolicyStore: a `{ load(key), save(key, value) }` adapter
 * that hides the underlying transport (localStorage on web, AsyncStorage
 * on RN, in-memory mock in tests).
 *
 * Layout: proposals are stored under a single key `cc.circleProposals`
 * holding `Record<circleId, Proposal[]>` — a circle can carry multiple
 * pending proposals (e.g. one admin proposes pod=shared, another proposes
 * agents=no).  Each proposal carries its own `id`, `patch`, and approval
 * state per circleConsensus.js.
 *
 * Cross-device delivery (the peer-to-peer fan-out + approve-from-other-
 * device flow) is the V1 follow-up; this V0 ships the persistence layer
 * + helpers so settings can record + surface + commit on unanimous
 * approval on-device, and so a future peer-receive handler has a stable
 * store to write to.
 */

const STORE_KEY = 'cc.circleProposals';

/**
 * Create a proposal store over a pluggable IO adapter.
 *
 * @param {object}   opts
 * @param {object}   opts.io                    `{ load(key), save(key, value) }`
 * @param {string}   [opts.storeKey=STORE_KEY]
 * @returns {{
 *   listForCircle: (circleId: string) => Promise<Array>,
 *   save:          (proposal: object)  => Promise<void>,
 *   remove:        (proposalId: string) => Promise<void>,
 *   updateOne:     (proposalId: string, fn: (p:object)=>object) => Promise<object|null>,
 *   countPending:  (circleId: string) => Promise<number>,
 * }}
 */
export function createProposalStore({ io, storeKey = STORE_KEY } = {}) {
  if (!io || typeof io.load !== 'function' || typeof io.save !== 'function') {
    throw new TypeError('createProposalStore: io must provide load + save');
  }

  async function readAll() {
    const raw = await io.load(storeKey);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    return {};
  }

  async function writeAll(map) {
    await io.save(storeKey, map);
  }

  /** Return the pending proposals for a circle (sorted oldest first). */
  async function listForCircle(circleId) {
    const all = await readAll();
    const list = Array.isArray(all[circleId]) ? all[circleId] : [];
    return [...list].sort((a, b) => (a.proposedAt ?? 0) - (b.proposedAt ?? 0));
  }

  /** Persist a proposal (insert or replace by `id`). */
  async function save(proposal) {
    if (!proposal || !proposal.id || !proposal.circleId) {
      throw new TypeError('save: proposal needs `id` and `circleId`');
    }
    const all = await readAll();
    const list = Array.isArray(all[proposal.circleId]) ? all[proposal.circleId] : [];
    const idx = list.findIndex((p) => p.id === proposal.id);
    if (idx >= 0) list[idx] = proposal;
    else list.push(proposal);
    all[proposal.circleId] = list;
    await writeAll(all);
  }

  /** Drop a proposal (commit or reject path). */
  async function remove(proposalId) {
    const all = await readAll();
    let touched = false;
    for (const cid of Object.keys(all)) {
      const list = all[cid];
      if (!Array.isArray(list)) continue;
      const next = list.filter((p) => p.id !== proposalId);
      if (next.length !== list.length) { all[cid] = next; touched = true; }
      if (next.length === 0) delete all[cid];
    }
    if (touched) await writeAll(all);
  }

  /**
   * Atomic-ish update: find the proposal by id, run `fn(prev)` to produce
   * the new shape, and persist it.  Returns the updated proposal, or null
   * if the id wasn't found.
   */
  async function updateOne(proposalId, fn) {
    if (typeof fn !== 'function') return null;
    const all = await readAll();
    for (const cid of Object.keys(all)) {
      const list = Array.isArray(all[cid]) ? all[cid] : [];
      const idx = list.findIndex((p) => p.id === proposalId);
      if (idx >= 0) {
        const next = fn(list[idx]);
        if (!next) return null;
        list[idx] = next;
        all[cid] = list;
        await writeAll(all);
        return next;
      }
    }
    return null;
  }

  /** Count pending (non-'ready') proposals for a circle. */
  async function countPending(circleId) {
    const list = await listForCircle(circleId);
    return list.filter((p) => p.status !== 'ready').length;
  }

  return { listForCircle, save, remove, updateOne, countPending };
}

/** Convenience IO adapter over Web Storage (window.localStorage). */
export function localStorageProposalIo(storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
  if (!storage) throw new TypeError('localStorageProposalIo: no localStorage available');
  return {
    load: (key) => {
      try { const v = storage.getItem(key); return v ? JSON.parse(v) : null; }
      catch { return null; }
    },
    save: (key, value) => {
      try { storage.setItem(key, JSON.stringify(value)); }
      catch { /* quota / disabled — silent (host caller can re-detect on next read) */ }
    },
  };
}

// Persistent participant OWN-pod (web ≡ mobile) — wraps an in-memory CentralPod with a durable op-journal so
// the participant's CONSENTED Stage-1 contributions survive a reload / app restart. Without this the own pod
// is in-memory, so consent + the verify-summary round approval had to happen in ONE session (the raw was lost
// on reload). We DELEGATE all pod logic (validation, dedup, seal/verify, the status lifecycle) to the injected
// in-memory pod and add ONLY persistence: every mutation appends an op to a journal that is (a) replayed on
// load to rebuild the exact prior state and (b) written back to storage.
//
// SCOPE — the OWN pod ONLY. It stores the participant's own contributions on their OWN device (localStorage /
// AsyncStorage): the same trust boundary as keeping them in memory, just durable. NOT for the central /
// collector pod, whose content LEAVES the device and travels a signed/sealed path.
//
// Storage adapter: `{ getItem(key) -> string|null|Promise, setItem(key, value) -> void|Promise }` — plain
// localStorage on web, AsyncStorage on mobile. Sync AND async adapters both work (we always await).

/** Replay one journalled op onto a fresh delegate pod. */
function applyOp(pod, op) {
  if (op.op === 'write') pod.write(op.participant, op.raw, op.meta);
  else if (op.op === 'withdraw') pod.withdraw(op.participant, op.id);
  else if (op.op === 'markIncluded') pod.markIncluded(op.ids);
}

/**
 * Build a persisted own-pod. Async because it rehydrates from storage before first use — pass the returned
 * Promise straight to `createFeedbackSurface({ pod })` (the surface resolves value/Promise/thunk pods).
 *
 * @param {object} a
 * @param {{getItem:(k:string)=>any, setItem:(k:string,v:string)=>any}} a.storage
 * @param {string} a.key            storage key (namespace per project / thread)
 * @param {()=>object} a.make       factory for a fresh in-memory CentralPod (the delegate that owns all logic)
 * @returns {Promise<object>}       a pod exposing the CentralPod interface, transparently persisted
 */
export async function makePersistentOwnPod({ storage, key, make }) {
  const inner = make();
  const journal = [];
  // Rehydrate: replay the persisted op-journal into the fresh pod → exact prior state (incl. status).
  try {
    const rawJournal = await storage.getItem(key);
    const ops = rawJournal ? JSON.parse(rawJournal) : [];
    for (const op of Array.isArray(ops) ? ops : []) {
      try { applyOp(inner, op); journal.push(op); }
      catch { /* a stale/invalid op (e.g. a dup from a partial prior write) is skipped, never fatal */ }
    }
  } catch { /* missing / corrupt storage → start empty; the pod still works for this session */ }

  // Best-effort durable writes, serialized so a slow setItem can't persist a stale snapshot after a newer one.
  // A failed persist never throws into the caller — the in-memory state stays correct; only durability is lost.
  let persisting = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(journal);
    persisting = persisting.then(() => storage.setItem(key, snapshot)).catch(() => {});
    return persisting;
  };
  const record = (op, ret) => { journal.push(op); persist(); return ret; };

  return {
    write(participant, raw, meta = {}) {
      const id = inner.write(participant, raw, meta);   // may throw (dup / verify) → deliberately NOT journalled
      return record({ op: 'write', participant, raw, meta }, id);
    },
    withdraw(participant, id) { inner.withdraw(participant, id); record({ op: 'withdraw', participant, id }); },
    markIncluded(ids) { inner.markIncluded(ids); record({ op: 'markIncluded', ids }); },
    getStatus: (id) => inner.getStatus(id),
    list: () => inner.list(),
    forAggregation: () => inner.forAggregation(),
    /** Await all pending persistence (tests / explicit save points). */
    flush: () => persisting,
  };
}

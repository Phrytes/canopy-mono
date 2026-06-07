// The CentralPod contract — the seam that makes pod backends PLUGGABLE (PR-4). Every backend
// (InMemoryCentralPod, CssCentralPod, PseudoPodCentralPod, ByoCentralPod, and a future
// iGrant.io backend) implements the same shape, so the channels, curator, and aggregation
// don't care where the contributions actually live. The methods may be sync or async; callers
// always `await` them.
//
//   write(participant, contribution, meta?)  → id      consent = the write (seal/verify here)
//   withdraw(participant, id)                          delete your own, before release
//   markIncluded(ids)                                  terminal; blocks withdrawal
//   getStatus(id)                            → status
//   list()                                   → [{ participant, contribution }]
//   forAggregation()                         → [{ user, id, text, lang }]
//
// A backend may legitimately implement a read-only subset (e.g. a BYO aggregation view has no
// server-side write/withdraw — those happen on the participant's own pod). `assertCentralPod`
// checks the methods a given caller needs.

export const CENTRAL_POD_METHODS = ['write', 'withdraw', 'markIncluded', 'getStatus', 'list', 'forAggregation'];

/** Duck-type a pod backend. Pass `need` to require only the subset a caller uses (e.g. an
 *  aggregation job needs ['forAggregation']; a channel needs ['write']). */
export function assertCentralPod(pod, need = CENTRAL_POD_METHODS) {
  if (!pod || typeof pod !== 'object') throw new Error('assertCentralPod: not a pod');
  const missing = need.filter((m) => typeof pod[m] !== 'function');
  if (missing.length) throw new Error(`assertCentralPod: backend missing method(s): ${missing.join(', ')}`);
  return pod;
}

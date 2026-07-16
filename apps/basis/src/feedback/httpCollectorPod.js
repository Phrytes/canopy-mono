// Browser → companion-node collector adapter. Implements the minimal `pod` contract the feedback
// dispatcher calls on consent (`write` / `withdraw`) by POSTing the SIGNED record to the companion
// collector (apps/companion-node/src/feedbackCollector.js), which — holding the central pod's write
// credential — files it under the participant's pseudonym. The participant never logs in to the pod.
//
// This is the no-login central-pod route: the browser signs with its agent identity (the dispatcher
// builds `meta = {sig, pubKey}`), and the companion is the authenticated server-side writer. Raw text
// stays local; only what the participant consents to is handed over.

/**
 * @param {string} collectorUrl  base URL of the companion collector, e.g. http://localhost:8790
 * @param {object} [opts]
 * @param {string} [opts.participantKey]  this device's agent pubkey — enables `list()` to read THIS
 *   participant's own released records (the verify-summary loop's already-verified check). A participant
 *   may only query their own pseudonym, so nothing leaks across participants.
 * @returns {{ write:Function, withdraw:Function, list:Function }}
 */
export function makeHttpCollectorPod(collectorUrl, { participantKey } = {}) {
  const base = collectorUrl.replace(/\/+$/, '');
  const post = async (path, payload) => {
    const r = await fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    let body = null; try { body = await r.json(); } catch { /* non-JSON */ }
    if (!r.ok) throw new Error(body?.error || `collector ${path} failed: HTTP ${r.status}`);
    return body;
  };
  return {
    // The dispatcher calls pod.write(participant, contribution, meta); participant is the agent public
    // key (it is what the signature is computed over), so the collector files + verifies consistently.
    async write(participant, contribution, meta = {}) {
      await post('/collect', { participant, contribution, meta });
      return contribution.id;
    },
    async withdraw(participant, id, meta = {}) {
      await post('/withdraw', { participant, id, meta });
    },
    // Read THIS participant's own released records (verify-summary loop: pendingRoundsFor uses it to skip
    // rounds already verified). Without a participantKey there is nothing to scope to → empty.
    async list() {
      if (!participantKey) return [];
      const r = await fetch(`${base}/mine?participant=${encodeURIComponent(participantKey)}`);
      return r.ok ? r.json() : [];
    },
  };
}

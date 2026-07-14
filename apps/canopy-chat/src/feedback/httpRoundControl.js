// Browser round-control client for the verify-summary loop. Satisfies the feedback loop's control-store
// contract (`writeRound` / `listRounds`) by talking to the companion collector's round endpoints. The PM
// opens a round (POST /round/open); the participant device polls the open rounds (GET /rounds) and, for
// any round it hasn't verified, produces + releases its OWN summary. Pull by design: the lead requests a
// verification, never extracts one.

/** @param {string} collectorUrl base URL of the companion collector, e.g. http://localhost:8790 */
export function makeHttpRoundControl(collectorUrl) {
  const base = collectorUrl.replace(/\/+$/, '');
  return {
    async writeRound(req) {
      const r = await fetch(`${base}/round/open`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req),
      });
      return r.ok ? r.json() : req;
    },
    async listRounds(projectId) {
      const r = await fetch(`${base}/rounds?projectId=${encodeURIComponent(projectId)}`);
      return r.ok ? r.json() : [];
    },
  };
}

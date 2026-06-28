// Verify-summary loop — round control (the LEAD TRIGGER). See docs/DESIGN-verify-summary-loop.md §3.
//
// The project LEAD opens a verification round by writing a `verification-request` to a shared control
// store; the participant's BOT polls on open and opens the verify-turn for any round it hasn't yet
// verified. Pull/poll by design: the lead writes DATA — only the participant's own bot produces +
// releases the summary, so the lead can request a verification, never extract one.

/**
 * Control-store interface (duck-typed): `writeRound(req)` + `listRounds(projectId)`.
 * Pod-backed in production (a project `/control/` container the lead writes + participants read);
 * the in-memory one below is for tests + the local demo.
 */
export class InMemoryRoundControl {
  #rounds = [];
  async writeRound(req) { this.#rounds.push({ ...req }); return req; }
  async listRounds(projectId) { return this.#rounds.filter((r) => !projectId || r.projectId === projectId); }
  toJSON() { return { rounds: this.#rounds }; }
  static fromJSON(obj) { const c = new InMemoryRoundControl(); for (const r of (obj?.rounds || [])) c.#rounds.push(r); return c; }
}

/**
 * Pod-backed control store — rounds live as records in a shared `/control/` container (the lead writes
 * via the portal, participants read on their device). Pod-agnostic: any pod with `write()`/`list()`
 * satisfies it (a flat `CssCentralPod` in production, `InMemoryCentralPod` in tests).
 */
export class PodRoundControl {
  #pod;
  constructor({ pod }) {
    if (!pod || typeof pod.write !== 'function' || typeof pod.list !== 'function') {
      throw new Error('PodRoundControl: a pod with write()/list() is required');
    }
    this.#pod = pod;
  }
  // a round is stored as a contribution-shaped record (text = the round JSON) so any pod — including a
  // contribution-validating one — accepts it; listRounds parses it back.
  async writeRound(req) { await this.#pod.write('rounds', { id: `round-${req.projectId}-${req.round}`, text: JSON.stringify(req) }, {}); return req; }
  async listRounds(projectId) {
    const recs = await this.#pod.list();
    return recs
      .map((r) => { const c = r.contribution ?? r; try { return JSON.parse(c.text); } catch { return null; } })
      .filter((r) => r && r.round != null && (!projectId || r.projectId === projectId));
  }
}

/**
 * LEAD action — open a verification round. Idempotent per {projectId, round}.
 * @returns {Promise<{projectId, round, openedAt, openedBy?, message?, deadline?}>}
 */
export async function openVerificationRound({ controlStore, projectId, round, openedBy, message, deadline, now = () => new Date().toISOString() }) {
  if (!controlStore || !projectId || round == null) throw new Error('openVerificationRound: controlStore, projectId, round required');
  const existing = (await controlStore.listRounds(projectId)).find((r) => r.round === round);
  if (existing) return existing;
  const req = {
    projectId, round, openedAt: now(),
    ...(openedBy ? { openedBy } : {}), ...(message ? { message } : {}), ...(deadline ? { deadline } : {}),
  };
  await controlStore.writeRound(req);
  return req;
}

/**
 * PARTICIPANT bot — the open rounds this participant has NOT yet verified (no verified-summary on central).
 * @returns {Promise<Array>} pending rounds, oldest first
 */
export async function pendingRoundsFor({ controlStore, projectId, participant, centralPod }) {
  const rounds = await controlStore.listRounds(projectId);
  // the central read can fail (cross-login token to the CSS container); a failure just means "no verified
  // summary seen yet" — it must NOT throw the whole poll (which surfaced as 'geen open verificatieronde').
  let records = [];
  try { records = centralPod && typeof centralPod.list === 'function' ? await centralPod.list() : []; }
  catch { /* central read failed (e.g. cross-login token to the CSS container) → treat as no verified summary yet */ }
  const verified = new Set(
    records
      .filter((r) => (r.participant ?? r.user) === participant)
      .map((r) => r.contribution?.id ?? r.id)
      .filter(Boolean),
  );
  return rounds
    .filter((r) => !verified.has(`${participant}:summary:${r.round}`))
    .sort((a, b) => String(a.openedAt).localeCompare(String(b.openedAt)));
}

/**
 * Lead status — how many participants have released a verified summary for a round (counts the
 * `verified-summary` records on the central pod whose id ends in `:summary:<round>`). The portal shows
 * this against the activation count. Returns 0 when no central pod is available.
 */
export async function verifiedCountFor({ centralPod, round }) {
  if (!centralPod || typeof centralPod.list !== 'function') return 0;
  const records = await centralPod.list();
  const suffix = `:summary:${round}`;
  return records.filter((r) => {
    const c = r.contribution ?? r;
    return (c.themeTags || []).includes('verified-summary') && String(c.id || '').endsWith(suffix);
  }).length;
}

/**
 * Bot POLL (run on contact-open): open the verify-turn for the FIRST pending unverified round, if any.
 * Returns the round it opened (or null). The dispatcher's `centralPod` must be the same one passed here.
 */
export async function pollAndOpenVerification({ dispatcher, controlStore, projectId, participant, centralPod, model, summarise }) {
  const pending = await pendingRoundsFor({ controlStore, projectId, participant, centralPod });
  if (!pending.length) return null;
  const next = pending[0];
  await dispatcher.openVerificationRound({ round: next.round, ...(model ? { model } : {}), ...(summarise ? { summarise } : {}) });
  return next;
}

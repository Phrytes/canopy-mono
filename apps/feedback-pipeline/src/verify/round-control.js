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
  const records = centralPod && typeof centralPod.list === 'function' ? await centralPod.list() : [];
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

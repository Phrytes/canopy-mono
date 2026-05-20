/**
 * callSkill — POST a skill invocation to a mountLocalUi-backed agent
 *             and return the response DataPart's `data`.
 *
 * Source: lifted verbatim from `apps/household/web/main.js` and
 * `apps/tasks-v0/web/app.js` (both were carrying identical copies).
 * One-shot dispatch (no streaming); use mountLive/SSE for live updates.
 *
 * Wire shape (A2A `/tasks/send` — what mountLocalUi accepts):
 *   POST <baseUrl>/tasks/send
 *   {
 *     skillId: "<id>",
 *     message: { parts: [{ type: 'DataPart', data: <args> }] }
 *   }
 *
 * Response shape:
 *   { status: 'completed', artifacts: [{ parts: [{type:'DataPart', data}] }] }
 *
 * Discipline:
 *   - Throws on non-2xx HTTP (Error message includes status + body).
 *   - Throws when `status` is set but not `completed` (skill error path).
 *   - Returns `{}` when the response has no DataPart (e.g. skills that
 *     emit only `replies[]` / status updates — caller can detect and
 *     fall back to its own polling).
 *
 * The `baseUrl` parameter is the agent's mount URL. Pass `''`
 * (default) for same-origin / relative POST, which is what both
 * household-web's main.js and tasks-v0's web/app.js do today. The
 * parameter exists so a future cross-origin tool (e.g. a debug panel
 * served from a different port) can call into a remote agent without
 * monkey-patching `fetch`.
 *
 * @param {string} baseUrl                  '' for relative, or `${origin}` prefix
 * @param {string} skillId
 * @param {object} [args={}]
 * @returns {Promise<object>}               data of the first DataPart, or {}
 */
export async function callSkill(baseUrl, skillId, args = {}) {
  if (typeof skillId !== 'string' || !skillId) {
    throw new Error('callSkill: skillId required');
  }
  const body = {
    skillId,
    message: { parts: [{ type: 'DataPart', data: args }] },
  };
  const res = await fetch(`${baseUrl}/tasks/send`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`${skillId}: ${res.status} ${errText}`);
  }
  const json = await res.json();
  if (json.status && json.status !== 'completed') {
    throw new Error(
      `${skillId}: ${json.status} — ${JSON.stringify(json.error ?? {})}`,
    );
  }
  const outParts = json.artifacts?.[0]?.parts ?? json.parts ?? [];
  const dp = outParts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

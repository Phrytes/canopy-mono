/**
 * agents — pure cores (read-only first slice).
 *
 * Uniform-route shape (decision #5): each core is a pure
 * `(store, args, ctx) → result` where `store` is an injected
 * `@canopy/agent-registry` instance (`createAgentRegistry(...)`).  The
 * SAME core is reachable two ways that MUST agree (see the fitness
 * test): LOCAL (called directly over the registry) and WIRE (wrapped by
 * `wireSkill` + registered as a `defineSkill`, invoked over serialized
 * parts).  Kept dependency-free so the module imports nothing external.
 *
 * READ-ONLY: no register / revoke / purge / grant here.  `listAgents`
 * filters soft-revoked entries; `viewAgent` resolves by agentId/pubKey.
 */

/** Registry entry → LIST row: name · role · status · lastSeen. */
function toRow(a) {
  return {
    agentId:  a.agentId,
    name:     a.name ?? null,
    role:     a.role ?? 'device',
    status:   a.revokedAt ? 'revoked' : 'active',
    // lastSeen ← `signedAt` (the registry's freshest per-agent stamp;
    // there is no dedicated last-seen field in the v2 resource shape).
    lastSeen: a.signedAt ?? null,
  };
}

/**
 * Derive the agent's skill set from its fine-grained grants
 * (`grants[].skill`) UNION its coarse mirrored `capabilities[]`.
 * Deduped + sorted for a stable, comparable surface.
 */
function deriveSkills(a) {
  const set = new Set();
  for (const g of a.grants ?? []) {
    if (typeof g.skill === 'string' && g.skill.length > 0) set.add(g.skill);
  }
  for (const c of a.capabilities ?? []) {
    if (typeof c === 'string' && c.length > 0) set.add(c);
  }
  return [...set].sort();
}

/** Compact grant summary for the detail record. */
function summariseGrants(grants = []) {
  return {
    total:  grants.length,
    tokens: grants.map((g) => ({
      tokenId:    g.tokenId,
      skill:      g.skill ?? null,
      capability: g.capability ?? null,
      subject:    g.subject ?? null,
      expiresAt:  g.expiresAt ?? null,
    })),
  };
}

/** Registry entry → DETAIL record. */
function toDetail(a) {
  return {
    agentId:      a.agentId,
    name:         a.name ?? null,
    role:         a.role ?? 'device',
    status:       a.revokedAt ? 'revoked' : 'active',
    lastSeen:     a.signedAt ?? null,
    skills:       deriveSkills(a),
    grantSummary: summariseGrants(a.grants),
  };
}

/**
 * listAgents — the non-revoked roster.  Soft-revoke is honoured here:
 * entries carrying a `revokedAt` are skipped (they stay in the resource
 * for audit, but never surface in the list).
 *
 * @param {object} registry  an `@canopy/agent-registry` instance
 * @returns {Promise<{ agents: Array<object> }>}
 */
export async function listAgents(registry /*, args, ctx */) {
  const entries = await registry.list();
  return {
    agents: entries.filter((a) => !a.revokedAt).map(toRow),
  };
}

/**
 * viewAgent — one agent's detail, resolved by `agentId` OR `pubKey`
 * ONLY (deliberately NOT webid/agentUri/deviceId — a webid is ambiguous
 * for multi-device users).  Unlike the list, viewAgent DOES surface a
 * revoked agent (with `status: 'revoked'`) so detail lookups stay
 * addressable.  Returns `{ agent: null }` on miss.
 *
 * @param {object} registry
 * @param {{ agentId?: string }} args
 * @returns {Promise<{ agent: object | null }>}
 */
export async function viewAgent(registry, args = {}) {
  const key = args?.agentId;
  if (typeof key !== 'string' || key.length === 0) {
    return { agent: null };
  }
  const entries = await registry.list();
  const entry = entries.find((a) => a.agentId === key || a.pubKey === key) ?? null;
  return { agent: entry ? toDetail(entry) : null };
}

/**
 * The extracted-core map (mirrors tasks-v0's `TASK_CORES`) — the wire
 * module wraps each of these with `wireSkill`, and the fitness test
 * checks route parity against `manifest.operations`.
 */
export const AGENT_CORES = Object.freeze({
  listAgents,
  viewAgent,
});

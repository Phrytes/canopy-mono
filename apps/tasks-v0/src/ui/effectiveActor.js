/**
 * effectiveActor — resolve the caller's identity to a webid the
 * circle's roles map can find.
 *
 * Phase 41.18 follow-up (2026-05-10) — created alongside the
 * `apps/tasks-v0/src/ui/` lift per the
 * "Shared UI-glue helpers between platform shells" rule
 * (`Project Files/conventions/architectural-layering.md`).
 *
 * Why this exists
 * ---------------
 * The roles map is keyed on **webid**. The dispatch layer's `from`
 * field carries different things on different platforms:
 *
 *   - Desktop HTTP path: `LocalUiAuth` injects the configured
 *     localActor as `peerId`, which lands as `envelope._from = webid`.
 *     Roles lookup hits directly. ✓
 *
 *   - Mobile React-bindings path: the agent dispatches with
 *     `from = agent.pubKey` (no LocalUiAuth in the loop). Roles
 *     lookup misses; the substrate's `buildStandardRolePolicy(roles,
 *     {aliases})` resolves through the alias map (pubKey → webid).
 *
 *   - Desktop relay path (future): an envelope arriving over a
 *     relay carries `_from = relay.pubKey` and `_origin =
 *     <originating-actor>`. The circle's role-policy gate must look
 *     at the origin, not the relay.
 *
 * Both shells benefit from the same resolver: take whatever the
 * caller has (a from string, an envelope, an identity object) and
 * return the webid that the roles map expects. UI consumers
 * (`useActiveRole`, role-gated render branches in TaskDetail)
 * already need this lookup; centralising it keeps both shells in
 * step with the substrate-side alias rule.
 *
 * Pure-fn only — must not import from `react-native`, DOM globals,
 * or any platform module.
 */

/**
 * Resolve a caller identifier (pubKey or webid) to the webid the
 * circle's roles table expects. Returns `null` when no resolution is
 * possible.
 *
 * Resolution order:
 *   1. The supplied `from` matches a key in `circleState.roles`     → return as-is
 *   2. The supplied `from` matches a key in `circleState.actorAliases`
 *      (pubKey → webid map; populated by `buildCircleState` from the
 *      circle's members)                                            → return aliased webid
 *   3. The envelope carries an `_origin` (relay-forwarded call)
 *      that resolves through 1 or 2                                → return that
 *   4. fallback                                                    → null
 *
 * @param {object} args
 * @param {string|null} [args.from]              dispatch-layer `from`
 * @param {object} [args.envelope]               raw inbound envelope (for `_origin`)
 * @param {object} [args.circleState]              `{roles, actorAliases}` shape
 * @returns {string|null}                        webid suitable for `roles[<webid>]`
 */
export function resolveActorWebid({ from = null, envelope = null, circleState = null } = {}) {
  if (!circleState) return from ?? null;
  const roles   = circleState.roles ?? {};
  const aliases = circleState.actorAliases ?? {};

  const lookup = (id) => {
    if (typeof id !== 'string' || !id) return null;
    if (roles[id] !== undefined) return id;
    const aliased = aliases[id];
    if (typeof aliased === 'string' && roles[aliased] !== undefined) return aliased;
    return null;
  };

  const direct = lookup(from);
  if (direct) return direct;

  // Relay-forwarded call: prefer the original sender if the envelope
  // carries one and it resolves.
  const origin = envelope?._origin;
  const relayed = lookup(origin);
  if (relayed) return relayed;

  return null;
}

/**
 * Look up the caller's role in the active circle, going through the
 * alias map. Returns `null` when the caller isn't a member.
 *
 * Used by mobile's `useActiveRole` hook + by every UI gate that
 * branches on role.
 *
 * @param {object} args
 * @param {string|null} [args.from]
 * @param {object} [args.envelope]
 * @param {object} [args.circleState]
 * @returns {string|null}                role label ('admin' | 'coordinator' | 'member' | 'observer' | 'external-volunteer' | custom | null)
 */
export function resolveActorRole({ from = null, envelope = null, circleState = null } = {}) {
  if (!circleState) return null;
  const webid = resolveActorWebid({ from, envelope, circleState });
  if (!webid) return null;
  return circleState.roles?.[webid] ?? null;
}

/**
 * Build the alias map shape that `buildStandardRolePolicy(roles,
 * {aliases})` expects, from a list of circle members.
 *
 * Mirror of the inline construction in
 * `apps/tasks-mobile/src/lib/buildCircleState.js` — extracted here so
 * the desktop's Circle.js can use the same shape when relay-forwarded
 * calls land an `_origin` that's a pubKey rather than a webid.
 *
 * @param {Array<{webid?: string, pubKey?: string}>} members
 * @returns {Object<string, string>}    pubKey → webid map
 */
export function buildActorAliases(members = []) {
  const aliases = {};
  for (const m of members) {
    if (m?.pubKey && m?.webid && m.pubKey !== m.webid) {
      aliases[m.pubKey] = m.webid;
    }
  }
  return aliases;
}

/**
 * Phase 52.11 migration helper — adapt a circle-members list to the
 * `actorResolver` shape that `buildStandardRolePolicy` accepts.
 *
 * Returned object exposes a SYNC `resolveSync(id) → {webid?: string}`
 * — role policies gate every read/write so the lookup must be
 * non-promise. For V0 the resolver is just a wrapper around the
 * circle's local member list (same data as `buildActorAliases`). When
 * `@onderling/agent-registry` is wired into mobile (real PoC
 * dogfooding), apps swap the data source from `circle.members` to a
 * sync cache over the registry — interface stays identical so the
 * substrate side doesn't move.
 *
 * @param {Array<{webid?: string, pubKey?: string, agentUri?: string}>} members
 * @returns {{ resolveSync: (id: string) => {webid: string} | null }}
 */
export function buildActorResolverFromMembers(members = []) {
  const byId = new Map();
  for (const m of members) {
    if (!m || typeof m.webid !== 'string' || m.webid.length === 0) continue;
    byId.set(m.webid, m.webid);
    if (typeof m.pubKey   === 'string' && m.pubKey.length > 0)   byId.set(m.pubKey,   m.webid);
    if (typeof m.agentUri === 'string' && m.agentUri.length > 0) byId.set(m.agentUri, m.webid);
  }
  return {
    resolveSync(id) {
      if (typeof id !== 'string' || id.length === 0) return null;
      const webid = byId.get(id);
      return webid ? { webid } : null;
    },
  };
}

/**
 * capabilities — the `get-capabilities` skill (Group AA3).
 *
 * Returns a point-in-time snapshot of the agent's feature flags so peers
 * can refresh what they learned from the hello payload. Cheap to call;
 * intended to be polled on demand (e.g. after reconnection, or when a
 * user action might change what the agent offers).
 *
 * The snapshot is a plain object; unknown-field forward-compat is the
 * receiver's responsibility — don't strip unrecognised keys.
 *
 * Ref: Design-v3/rendezvous-mode.md §5b.
 */
import { DataPart } from '../Parts.js';

/**
 * Register the `get-capabilities` skill on the given agent.
 * Idempotent.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} [opts]
 * @param {'public'|'authenticated'|'trusted'|'private'} [opts.visibility='authenticated']
 *   Who may call the skill. Default matches the rest of the SDK's "only
 *   hello'd peers see this" posture.
 */
export function registerCapabilitiesSkill(agent, opts = {}) {
  const visibility = opts.visibility ?? 'authenticated';

  agent.register('get-capabilities', async () => {
    return [DataPart(_snapshot(agent))];
  }, {
    visibility,
    description: 'Report the agent\'s currently-enabled feature flags',
  });
}

/**
 * Produce a capabilities snapshot for `agent`.
 *
 * Exported for unit tests and for the hello-handshake helper in
 * `protocol/hello.js`. Keep the shape stable and additive:
 *   • Known flags map to booleans or short arrays.
 *   • Absence of a flag means "not advertised" — NOT "explicit false."
 *   • Peers must ignore unrecognised keys.
 *
 * @param {import('../Agent.js').Agent} agent
 */
export function _snapshot(agent) {
  return {
    rendezvous: !!agent._rendezvousEnabled,
    originSig:  true,                     // Group Z shipped
    relay:      !!agent.skills?.get?.('relay-forward')?.enabled,
    oracle:     !!agent.skills?.get?.('reachable-peers')?.enabled,
    tunnel:     !!agent.skills?.get?.('tunnel-open')?.enabled,   // Group CC
    groups:     _groupsAsMember(agent),
    skills:     _skillPostures(agent),
  };
}

/**
 * Per-skill posture metadata for the agent card (Group D1).
 *
 * Returns one entry per registered skill:
 *   { id, posture: 'always'|'negotiable',
 *         humanInTheLoop: 'never'|'either'|'required' }
 *
 * Peers consume this to know which skills can be negotiated or require
 * a human responder before invoking; D2 also reuses these values to
 * compute pubsub topic segments.  Skills registered before Group D1
 * are exposed with the defaults (`always` / `never`) thanks to the
 * defineSkill backward-compat layer, so unrecognised skill records do
 * not break the snapshot.
 *
 * @param {import('../Agent.js').Agent} agent
 */
function _skillPostures(agent) {
  const reg = agent.skills;
  if (!reg || typeof reg.all !== 'function') return [];
  return reg.all().map(s => ({
    id:             s.id,
    posture:        s.posture        ?? 'always',
    humanInTheLoop: s.humanInTheLoop ?? 'never',
  }));
}

function _groupsAsMember(agent) {
  const gm = agent.security?.groupManager;
  if (!gm || typeof gm.listProofs !== 'function') return [];
  try {
    // Best-effort — tolerate async or sync impls; skip if the API differs.
    const v = gm.listProofs();
    if (Array.isArray(v)) return v.map(p => p.groupId ?? p).filter(Boolean);
  } catch { /* fall through */ }
  return [];
}

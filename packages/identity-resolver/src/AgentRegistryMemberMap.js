/**
 * AgentRegistryMemberMap — MemberMap-shaped adapter over
 * `@canopy/agent-registry`.
 *
 * Implements the `resolveByWebid` / `resolveByPubKey` /
 * `resolveByExternalId` surface the rest of identity-resolver
 * consumes, but pulls the data from the canonical agent-registry
 * pod resource rather than from a per-app in-memory roster.
 *
 * Strict layering: identity-resolver consumes agent-registry via the
 * `registry`-shaped interface (lookup / list). No import of the
 * agent-registry package itself — callers wire the registry instance.
 *
 * Standardisation Phase 52.11.1 — see plan §52.11.
 */

/**
 * @typedef {{
 *   lookup: (identifier: string) => Promise<object|null>,
 *   list:   () => Promise<object[]>,
 * }} AgentRegistryLike
 */

/**
 * Adapt an agent-registry entry into MemberMap's member-shaped
 * object. Returns a plain object — never frozen, since callers
 * conventionally treat MemberMap returns as read-only-via-copy.
 */
function _toMember(entry) {
  if (!entry) return null;
  return {
    webid:        entry.webid ?? null,
    handle:       null,                // agent-registry doesn't carry a handle yet
    displayName:  entry.name ?? null,
    pubKey:       entry.pubKey ?? null,
    avatarUrl:    null,
    stableId:     entry.agentId ?? null,
    role:         entry.role ?? 'device',
    capabilities: Array.isArray(entry.capabilities) ? [...entry.capabilities] : [],
    deviceId:     entry.deviceId ?? null,
    revokedAt:    entry.revokedAt ?? null,
    agentUri:     entry.agentUri ?? null,
  };
}

/**
 * @param {AgentRegistryLike} registry
 * @returns {{
 *   resolveByWebid:      (webid: string) => Promise<object|null>,
 *   resolveByPubKey:     (pubKey: string) => Promise<object|null>,
 *   resolveByExternalId: (ns: string, value: string) => Promise<object|null>,
 *   listMembers:         () => Promise<object[]>,
 *   on?:                 never,
 * }}
 */
export function createAgentRegistryMemberMap(registry) {
  if (!registry || typeof registry.lookup !== 'function') {
    throw Object.assign(
      new Error('createAgentRegistryMemberMap: registry is required (must expose lookup + list)'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  async function resolveByWebid(webid) {
    if (typeof webid !== 'string' || webid.length === 0) return null;
    const entry = await registry.lookup(webid);
    return _toMember(entry);
  }

  async function resolveByPubKey(pubKey) {
    if (typeof pubKey !== 'string' || pubKey.length === 0) return null;
    const entry = await registry.lookup(pubKey);
    return _toMember(entry);
  }

  async function resolveByExternalId(ns, value) {
    // V0: only `deviceId` and `agentUri` external IDs are surfaced through
    // the registry. Apps that need `telegramUid` / `email` / etc. still
    // use the legacy MemberMap.
    if (ns === 'deviceId' || ns === 'agentUri') {
      const entry = await registry.lookup(value);
      return _toMember(entry);
    }
    return null;
  }

  async function listMembers() {
    if (typeof registry.list !== 'function') return [];
    const all = await registry.list();
    return all.map(_toMember).filter(Boolean);
  }

  return {
    resolveByWebid,
    resolveByPubKey,
    resolveByExternalId,
    listMembers,
  };
}

/**
 * makeActorResolver(registry) — adapts an agent-registry into a
 * core `ActorResolver`-shaped object.
 *
 * Indexes by pubKey / webid / agentUri / agentId / deviceId. The
 * lookup is async (delegates to `registry.lookup`); core's
 * ActorResolver interface allows async resolvers.
 *
 * Strict layering: substrate consumes core's interface; core never
 * imports the substrate.
 *
 * Standardisation Phase 52.10.5.
 *
 * @typedef {import('@onderling/core').ActorResolver} ActorResolver
 */

/**
 * Adapt an agent-registry handle into a core `ActorResolver`-shaped object whose async
 * `resolve` / `register` / `revoke` delegate to the registry. Throws INVALID_ARGUMENT when the
 * registry handle has no `lookup`.
 *
 * @param {ReturnType<import('./AgentRegistry.js').createAgentRegistry>} registry
 * @returns {ActorResolver}
 */
export function makeActorResolver(registry) {
  if (!registry || typeof registry.lookup !== 'function') {
    throw Object.assign(
      new Error('makeActorResolver: registry is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  return {
    async resolve(identifier) {
      if (typeof identifier !== 'string') return null;
      const entry = await registry.lookup(identifier);
      if (!entry) return null;
      return {
        pubKey:        entry.pubKey,
        webid:         entry.webid ?? null,
        agentUri:      entry.agentUri,
        role:          entry.role,
        capabilities:  entry.capabilities ?? [],
        revokedAt:     entry.revokedAt ?? null,
      };
    },

    async register(record) {
      if (!record || typeof record !== 'object') return;
      const agentId  = record.agentId ?? record.agentUri ?? record.pubKey;
      const agentUri = record.agentUri ?? record.webid ?? `pseudo-pod://${record.deviceId ?? 'unknown'}/agent`;
      await registry.register({
        agentId,
        pubKey:       record.pubKey,
        webid:        record.webid ?? null,
        agentUri,
        role:         record.role ?? 'device',
        name:         record.name ?? null,
        deviceId:     record.deviceId ?? null,
        capabilities: record.capabilities ?? [],
      });
    },

    async revoke(identifier) {
      await registry.revoke(identifier);
    },
  };
}

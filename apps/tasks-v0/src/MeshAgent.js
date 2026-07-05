/**
 * MeshAgent — Tasks V2.8 process-level shared agent.
 *
 * Lifts the `core.Agent` + `policyEngine` + `trustRegistry` +
 * `tokenRegistry` + identity vault out of `createCrewAgent` so a
 * single agent serves every crew the process knows about. Mirrors
 * Stoop's 2026-05-08 single-agent refactor (see
 * `Project Files/Stoop/single-agent-refactor-2026-05-08.md` § "Tasks-app
 * fix propagation"). Per-crew state lives in `CrewState` (see
 * `./Crew.js`); skills register once via `./wireSkills.js` with a
 * `bundleResolver` that picks the right CrewState per call.
 *
 * Why one agent per process:
 *   - One transport stack (one mDNS registration, one relay socket,
 *     one InternalBus listener per channel).
 *   - One PolicyEngine + TrustRegistry + TokenRegistry — V1.5 self-trust
 *     is set once.
 *   - One identity vault — V2.0's restart-survival snapshot lives at
 *     a process-level path, not per-crew.
 *   - Cap-token-bound bot agents (V1.5) still spin up per binding;
 *     they share the same bus the meshAgent uses, so they reach the
 *     meshAgent transparently.
 */

import { Agent, AgentIdentity, InternalBus, InternalTransport, TrustRegistry, PolicyEngine } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

const DEFAULT_IDENTITY_VAULT_PATH = 'mem://tasks/process/agent-identity-vault.json';

/**
 * @param {object} args
 * @param {object} [args.identity]
 * @param {object} [args.transport]
 * @param {object} [args.localStoreBundle]
 *   When supplied + `identityVault` is set, the vault snapshot is
 *   read/written via `localStoreBundle.cache` so the agent identity
 *   survives CLI restarts. (V2.0 mechanism, lifted to process scope.)
 * @param {string} [args.identityVault=mem://tasks/process/agent-identity-vault.json]
 * @param {string} [args.label='TasksMeshAgent']
 * @returns {Promise<{
 *   meshAgent:       object,
 *   vault:           object,
 *   identity:        object,
 *   identityVault:   string,
 *   policyEngine:    object,
 *   trustRegistry:   object,
 * }>}
 */
export async function buildMeshAgent({
  identity,
  transport,
  localStoreBundle,
  identityVault = DEFAULT_IDENTITY_VAULT_PATH,
  label = 'TasksMeshAgent',
  agent: existingAgent,
} = {}) {
  // Multi-crew runtime (2026-05-14, Tasks V2 sixth slice) — when a
  // pre-built `core.Agent` is supplied, reuse it instead of creating
  // a fresh one. The caller owns identity/transport/vault/policy/trust
  // wiring. Used by `bin/tasks-ui.js` to share one agent across N
  // crew bundles. Returns the same surface shape as the
  // build-from-scratch path.
  if (existingAgent) {
    return {
      meshAgent:     existingAgent,
      vault:         existingAgent.vault ?? null,
      identity:      existingAgent.identity,
      identityVault,
      policyEngine:  existingAgent.policyEngine ?? null,
      trustRegistry: existingAgent.trustRegistry ?? null,
    };
  }

  // ── Vault + identity (V2.0 vault-snapshot persistence) ────────────────────
  let vault;
  let id;
  let restoredFromSnapshot = false;
  const persistVault = !!(identityVault && localStoreBundle?.cache);
  if (persistVault && !identity) {
    try {
      const raw = await localStoreBundle.cache.read(identityVault);
      if (raw) {
        const snap = typeof raw === 'string' ? JSON.parse(raw) : raw;
        vault = VaultMemory.fromSnapshot(snap);
        id    = await AgentIdentity.restore(vault);
        restoredFromSnapshot = true;
      }
    } catch { /* fall through to generate */ }
  }
  if (!vault) {
    vault = new VaultMemory();
    id    = identity ?? await AgentIdentity.generate(vault);
  }

  // ── Transport ─────────────────────────────────────────────────────────────
  const tx = transport ?? new InternalTransport(new InternalBus(), id.pubKey);

  // ── TrustRegistry + self-trust (V1.5 — required by PolicyEngine for
  //    self-issued cap-tokens to validate). Idempotent.
  const trustRegistry = new TrustRegistry(vault);
  await trustRegistry.setTier(id.pubKey, 'trusted');

  // ── Agent ────────────────────────────────────────────────────────────────
  const agent = new Agent({
    identity:       id,
    transport:      tx,
    label,
    trustRegistry,
  });

  // PolicyEngine wires SkillRegistry (already on agent.skills) + the
  // trust registry above. Same pattern as V1.5 Crew.js — shadow the
  // read-only getter on the instance with an own property.
  const policyEngine = new PolicyEngine({
    trustRegistry,
    skillRegistry: agent.skills,
    agentPubKey:   id.pubKey,
  });
  Object.defineProperty(agent, 'policyEngine', { value: policyEngine, configurable: true });

  // ── Persist vault snapshot on first boot ─────────────────────────────────
  if (persistVault && !restoredFromSnapshot) {
    try {
      await localStoreBundle.cache.write(identityVault, JSON.stringify(vault.snapshot()));
    } catch { /* persistence failure must not break boot */ }
  }

  return {
    meshAgent:     agent,
    vault,
    identity:      id,
    identityVault,
    policyEngine,
    trustRegistry,
  };
}

export { DEFAULT_IDENTITY_VAULT_PATH };

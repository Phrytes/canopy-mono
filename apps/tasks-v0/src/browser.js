/**
 * tasks-v0 — browser entry for canopy-chat composition.
 *
 * Lets canopy-chat boot a real tasks-v0 Crew agent inside its own
 * browser bundle, sharing an `InternalBus` so canopy-chat's
 * chatAgent can `.invoke(crewAgent.address, skillId, parts)` to
 * reach every real task skill (addTask / claimTask / submitTask /
 * approveTask / listMyInbox / ...).
 *
 * Why this file
 *   The bin/<app>-ui.js launchers boot tasks-v0 as a node process
 *   for the multi-member testbed UX.  canopy-chat doesn't need
 *   that scaffolding — it already owns the bus, the identity vault,
 *   and the chat-shell surface.  It just needs the real tasks
 *   substrate composed in-process.  This factory does that.
 *
 * Boundary: this file imports ONLY the platform-neutral parts of
 * tasks-v0 — no node:fs / node:crypto / no bin scripts / no agent-ui
 * mount.  Per the architectural-layering convention.
 *
 * See `Project Files/canopy-chat/integration-plan-2026-05-23.md`
 * for the full per-app integration plan; this is slice 1.
 */

import {
  AgentIdentity, InternalTransport,
} from '@canopy/core';

import { buildBundle }     from './storage/buildBundle.js';
import { createCrewAgent } from './Crew.js';
import { buildMeshAgent }  from './MeshAgent.js';
import { wireSkills }      from './wireSkills.js';
import { multiCrewResolver, argsFromParts } from './bundleResolver.js';
import { buildMultiCrewOnboardingSkills }   from './skills/multiCrewOnboarding.js';

/**
 * Build a tasks-v0 Crew agent on the shared bus.
 *
 * @param {object} args
 * @param {InternalBus}    args.bus           shared bus (canopy-chat owns it)
 * @param {object}         args.identityVault Vault for the crew agent's identity;
 *                                            separate from the chat vault so
 *                                            crews don't pollute chat identity
 * @param {object}         args.crewConfig    {crewId, name, kind, members}
 * @param {string}         [args.label='TasksCrew']
 * @returns {Promise<{
 *   crew:    ReturnType<typeof createCrewAgent>,
 *   address: string,
 *   close:   () => Promise<void>,
 * }>}
 */
export async function createBrowserTasksAgent({
  bus,
  identityVault,
  crewConfig,
  label = 'TasksCrew',
}) {
  if (!bus) throw new TypeError('createBrowserTasksAgent: bus required');
  if (!identityVault) throw new TypeError('createBrowserTasksAgent: identityVault required');
  if (!crewConfig?.crewId) throw new TypeError('createBrowserTasksAgent: crewConfig.crewId required');

  // Per-crew identity, persisted in the supplied vault.  Survives
  // page reloads when the vault is VaultLocalStorage / VaultIndexedDB.
  const identity = await (async () => {
    if (await identityVault.has('agent-privkey')) {
      return AgentIdentity.restore(identityVault);
    }
    return AgentIdentity.generate(identityVault);
  })();

  // Local-first item store (Map-backed cache; restart-survival comes
  // from the caller's vault if needed via attachTasksBundle).
  const localStoreBundle = buildBundle();

  const crew = await createCrewAgent({
    crewConfig,
    localStoreBundle,
    // 2026-05-24 — flipped to true so canopy-chat's /invite + /redeem-invite
    // slashes (A9 #187) and /join-group wizard (C2 #196) actually reach
    // registered issueInvite / redeemInvite skills.  Earlier comment
    // "no invite issuance from chat-shell V0" predates A9 / C2.
    wireOnboardingSkills: true,
    identity,
    transport: new InternalTransport(bus, identity.pubKey),
    label,
  });

  return {
    crew,
    address: identity.pubKey,
    close:   () => crew.close?.(),
  };
}

/**
 * Build a MULTI-crew tasks-v0 runtime on canopy-chat's shared bus.
 *
 * Mirrors `buildMultiCrewRuntime` (the CLI / test fixture) but composes
 * onto a caller-owned `bus` + identity vault instead of generating its
 * own.  One `meshAgent` owns the skill registry; a `crewsMap` of
 * CrewStates is dispatched by `multiCrewResolver` from `args.crewId` /
 * `args._scope`.  Each crew gets its own item-store root
 * (`mem://tasks/crews/<crewId>/`), so storage is split per crew — and
 * since `circleId ≡ crewId` (CIRCLE_ID_IS_CREW_ID_ALIAS), per circle.
 *
 * canopy-chat addition over the CLI runtime:
 *   - `ensureCrew(crewId)` lazily spawns a crew the first time a circle
 *     is touched (no pre-saved config needed — it inherits the primary
 *     crew's members so the local actor stays recognised).
 *   - the resolver falls back to the PRIMARY crew for unscoped calls,
 *     preserving the legacy single-crew behaviour every existing
 *     chat-shell flow + test relies on.
 *
 * @param {object} args
 * @param {InternalBus} args.bus               shared bus (canopy-chat owns it)
 * @param {object}      args.identityVault      Vault for the mesh agent identity
 * @param {object}      args.primaryCrewConfig  {crewId, name, kind, members}
 * @param {string}      [args.label='TasksMeshAgent(cc)']
 * @returns {Promise<{
 *   agent:   object,            // the shared meshAgent (invoke target)
 *   address: string,            // meshAgent pubKey
 *   crewsMap: Map<string, object>,
 *   ensureCrew: (crewId: string, cfg?: object) => Promise<object|null>,
 *   primaryCrewState: object,
 *   close: () => Promise<void>,
 * }>}
 */
export async function createBrowserMultiCrewTasksAgent({
  bus,
  identityVault,
  primaryCrewConfig,
  label = 'TasksMeshAgent(cc)',
}) {
  if (!bus) throw new TypeError('createBrowserMultiCrewTasksAgent: bus required');
  if (!identityVault) throw new TypeError('createBrowserMultiCrewTasksAgent: identityVault required');
  if (!primaryCrewConfig?.crewId) {
    throw new TypeError('createBrowserMultiCrewTasksAgent: primaryCrewConfig.crewId required');
  }

  const identity = await (async () => {
    if (await identityVault.has('agent-privkey')) {
      return AgentIdentity.restore(identityVault);
    }
    return AgentIdentity.generate(identityVault);
  })();

  const localStoreBundle = buildBundle();

  const { meshAgent } = await buildMeshAgent({
    identity,
    transport: new InternalTransport(bus, identity.pubKey),
    localStoreBundle,
    label,
  });

  const primaryBundle = await createCrewAgent({
    crewConfig:           primaryCrewConfig,
    localStoreBundle,
    identity,
    transport:            meshAgent.transport,
    agent:                meshAgent,
    registerSkills:       false,   // wireSkills owns registration below
    wireOnboardingSkills: false,
  });
  const primaryCrewState = primaryBundle._crewState;
  const crewsMap = new Map([[primaryCrewState.crewId, primaryCrewState]]);

  // Members inherited by lazily-spawned circle crews so the local actor
  // (chat agent pubKey, registered admin on the primary crew) is
  // recognised — and not denied by RolePolicy — in every circle.
  const inheritedMembers = primaryCrewConfig.members ?? [];

  async function ensureCrew(crewId, cfg = {}) {
    if (typeof crewId !== 'string' || !crewId) return null;
    if (crewsMap.has(crewId)) return crewsMap.get(crewId);
    const spawned = await createCrewAgent({
      crewConfig: {
        crewId,
        name:    cfg.name    ?? crewId,
        kind:    cfg.kind    ?? primaryCrewConfig.kind ?? 'circle',
        members: cfg.members ?? inheritedMembers,
      },
      localStoreBundle,
      identity,
      transport:            meshAgent.transport,
      agent:                meshAgent,
      registerSkills:       false,
      wireOnboardingSkills: false,
    });
    const cs = spawned._crewState;
    crewsMap.set(crewId, cs);
    return cs;
  }

  // cc dispatch resolver: a scoped call (crewId/_scope) routes to that
  // crew; an unscoped call falls back to the primary crew (the legacy
  // single-crew path).  A scoped-but-unspawned crewId returns null —
  // the caller `ensureCrew()`s before dispatch, so this stays a guard
  // against silent cross-crew leaks rather than a hot path.
  const baseResolver = multiCrewResolver(crewsMap);
  function ccBundleResolver(parts, ctx) {
    const hit = baseResolver(parts, ctx);
    if (hit) return hit;
    const args = argsFromParts(parts);
    const scoped =
      (typeof args.crewId === 'string' && args.crewId) ||
      (typeof args._scope === 'string' && args._scope);
    return scoped ? null : primaryCrewState;
  }

  wireSkills({
    meshAgent,
    bundleResolver: ccBundleResolver,
    crewsProvider:  () => crewsMap.values(),
    members:        primaryBundle.members,
  });

  for (const def of buildMultiCrewOnboardingSkills({ bundleResolver: ccBundleResolver })) {
    meshAgent.skills.register(def);
  }

  await meshAgent.start();

  return {
    agent:   meshAgent,
    address: identity.pubKey,
    crewsMap,
    ensureCrew,
    primaryCrewState,
    close:   () => meshAgent.close?.(),
  };
}

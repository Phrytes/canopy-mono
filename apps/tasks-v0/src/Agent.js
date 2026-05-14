/**
 * TasksAgent — composition of substrates for H4 V0.
 *
 * Wires:
 *   - `core.Agent` from `@canopy/core` — real SkillRegistry + dispatch.
 *     V2.8: built once via `buildMeshAgent` (process-level shared agent).
 *   - L1b ItemStore (open/closed tasks, audit, role-policy gate at the
 *     item level via `buildStandardRolePolicy(roles)`)
 *   - L1h MemberMap (webid ↔ external-id resolution; resolveMember skill)
 *   - L1e SkillMatch (claim flow via pubsub-of-skills) — optional
 *   - L1f Notifier (deadline reminders, daily digest) — optional
 *
 * V2.8: Skills register ONCE via `wireSkills` against a per-process
 * meshAgent. The minimal CrewState that V0 builds carries just the
 * itemStore + dataSource + roles + members; richer wiring (chat,
 * bot, metrics) is left null and surfaced by `createCrewAgent`.
 *
 * Apps that want HTTP exposure call `mountLocalUi(bundle.agent)` from
 * `@canopy/agent-ui`; that wraps `core.A2ATransport` on 127.0.0.1.
 */

import {
  MemorySource,
} from '@canopy/core';
import { ItemStore } from '@canopy/item-store';
import { MemberMap } from '@canopy/identity-resolver';
import { SkillMatch } from '@canopy/skill-match';

import { buildStandardRolePolicy } from './rolePolicy.js';
import { buildMeshAgent } from './MeshAgent.js';
import { wireSkills } from './wireSkills.js';
import { singleCrewResolver } from './bundleResolver.js';

const V0_DEFAULT_CREW_ID = 'household';

/**
 * High-level tasks-agent factory.
 *
 * @param {object} args
 * @param {object} [args.itemBackend]
 * @param {object} [args.localStoreBundle]
 * @param {Object<string, string>} args.roles
 * @param {Array<object>} [args.members]
 * @param {object} [args.pod]
 * @param {object} args.pod.client
 * @param {string} args.pod.configUri
 * @param {Array<object>} [args.pod.fallback]
 * @param {object} [args.skillMatch]
 * @param {object} [args.notifier]
 * @param {object} [args.identity]
 * @param {object} [args.transport]
 * @param {string} [args.label='TasksAgent']
 * @param {() => object} [args.crewProvider]
 *   When supplied, the V2.8 CrewState's `liveCrew` getter delegates
 *   to this. Used by `createCrewAgent` so its richer config is the
 *   one observed by the registered skills.
 * @param {string} [args.identityVault]
 * @returns {Promise<{
 *   agent: object, itemStore: object, members: MemberMap,
 *   notifier: object | null, skillMatch: SkillMatch | null,
 *   localStore: object | null, _crewState: object,
 * }>}
 *   `_crewState` is exposed so `createCrewAgent` can enrich the
 *   per-crew wiring (chat / bot / metrics) without a second
 *   skill-registration pass.
 */
export async function createTasksAgent({
  itemBackend,
  localStoreBundle,
  roles,
  members:    initialMembers,
  pod:        podCfg,
  skillMatch: skillMatchOpts,
  notifier:   providedNotifier,
  identity,
  transport,
  label = 'TasksAgent',
  crewProvider,
  crewMutator: externalMutator,
  identityVault,
  // Multi-crew runtime (2026-05-14, Tasks V2 sixth slice) —
  // a pre-built `core.Agent` to reuse across crew bundles; when
  // truthy, `registerSkills` defaults to false so the CLI owns the
  // single wireSkills call.
  agent: sharedAgent,
  registerSkills,
  // Multi-crew runtime — per-crew item-store rootContainer. When
  // multiple crews share a single localStoreBundle, each needs its
  // own URI prefix so addTask writes don't leak across crews. The
  // legacy `'mem://tasks/'` is preserved as the default for the
  // single-crew path.
  itemStoreRoot,
}) {
  if (!roles || typeof roles !== 'object') {
    throw new TypeError('createTasksAgent: roles map required');
  }
  if (podCfg && initialMembers) {
    throw new TypeError('createTasksAgent: pass either `pod` or `members`, not both');
  }
  if (itemBackend && localStoreBundle) {
    throw new TypeError('createTasksAgent: pass either `itemBackend` or `localStoreBundle`, not both');
  }

  // ── Substrates ─────────────────────────────────────────────────────────────
  const policy    = buildStandardRolePolicy(roles);
  const dataSource = localStoreBundle?.cache ?? itemBackend ?? new MemorySource();
  // V2.7 — enforce hard subtask dependencies: parent can't close while
  // any of its `dependencies[]` is still open.
  const itemStore = new ItemStore({
    dataSource,
    rootContainer:        itemStoreRoot ?? 'mem://tasks/',
    rolePolicy:           policy,
    enforceDependencies:  true,
  });

  const members = podCfg
    ? await MemberMap.fromPodConfig({
        podClient: podCfg.client,
        configUri: podCfg.configUri,
        fallback:  podCfg.fallback,
      })
    : new MemberMap({ initial: initialMembers ?? [] });

  const notifier = providedNotifier ?? null;

  // ── MeshAgent (V2.8 — process-level shared agent) ────────────────────────
  const { meshAgent: agent, vault, identity: id } = await buildMeshAgent({
    identity,
    transport,
    localStoreBundle,
    identityVault,
    label,
    agent: sharedAgent,
  });

  // SkillMatch (Phase 4.2 — composes core.Agent + pubSub directly).
  let skillMatch = null;
  if (skillMatchOpts?.group) {
    skillMatch = new SkillMatch({
      agent,
      peers:      skillMatchOpts.peers ?? [],
      group:      skillMatchOpts.group,
      localActor: skillMatchOpts.localActor ?? null,
    });
    await skillMatch.start();
  }

  // ── CrewState (V2.8) ─────────────────────────────────────────────────────
  // V0 zero-config path — internal liveCrew + mutator (implicit household).
  // V1+ path (createCrewAgent) — passes its own crewProvider + crewMutator
  // so its richer config is the one observed by skills + the one its own
  // wiring (rewireCalendarEmission, rewireInvoicing, etc.) reads from.
  const useExternalCrew = typeof crewProvider === 'function';
  const useExternalMutator = typeof externalMutator === 'function';
  let internalLiveCrew = Object.freeze({
    crewId:     V0_DEFAULT_CREW_ID,
    name:       'Household',
    kind:       'household',
    members:    initialMembers ?? [],
    customRoles: [],
  });
  const crewState = {
    get crewId() {
      const lc = useExternalCrew ? crewProvider() : internalLiveCrew;
      return lc?.crewId ?? V0_DEFAULT_CREW_ID;
    },
    get liveCrew() {
      return useExternalCrew ? crewProvider() : internalLiveCrew;
    },
    crewMutator(patch) {
      if (useExternalMutator) {
        externalMutator(patch);
      } else {
        internalLiveCrew = Object.freeze({ ...internalLiveCrew, ...patch });
      }
    },
    roles,
    itemStore,
    dataSource,
    members,
    // V1+ wiring slots — left null on the V0 path; createCrewAgent
    // sets these post-construction.
    chatController:    null,
    botAgentRegistry:  null,
    metricsTracker:    null,
    notifierChannels:  null,
    onCalendarEmissionChange: null,
    onCompensationChange:     null,
  };

  // ── Skills (V2.8 — single registration via wireSkills) ───────────────────
  // Default behaviour: register skills here (single-crew path).
  // Multi-crew runtime (Tasks V2 sixth slice): when `registerSkills:
  // false` or when a shared `agent` is supplied (and the caller didn't
  // override), skip — the CLI calls wireSkills ONCE with a
  // multi-crew bundleResolver.
  const shouldRegisterSkills = typeof registerSkills === 'boolean'
    ? registerSkills
    : !sharedAgent;
  if (shouldRegisterSkills) {
    wireSkills({
      meshAgent: agent,
      bundleResolver: singleCrewResolver(crewState),
      members,
    });
  }

  if (!sharedAgent) {
    await agent.start();
  }

  return {
    agent,
    itemStore,
    members,
    notifier,
    skillMatch,
    localStore: localStoreBundle ?? null,
    _crewState: crewState,
  };
}

export { buildStandardRolePolicy } from './rolePolicy.js';
export { computeStatus, detectCycle } from './dag.js';

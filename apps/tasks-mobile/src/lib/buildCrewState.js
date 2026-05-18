/**
 * buildCrewState — minimum-viable per-crew state for the V2.8
 * single-agent topology.
 *
 * Phase 41.2 (2026-05-09).
 * M1-S1 (2026-05-18): `storage` field normalization — mirrors
 *   `apps/tasks-v0/src/Crew.js#_normaliseStorage`. All four §II.2
 *   policies accepted; V0 tier is the initial behaviour target.
 * M1-S3 (2026-05-18): substrate wiring (best-effort) when a
 *   `meshAgent` is supplied. Registers capabilities via
 *   `@canopy/agent-registry` and wires the tasks substrate-mirror.
 *   Forward-courtesy: `_podCtx: null` seam for M4.
 *
 * Mobile-local helper for now. The shape mirrors what
 * `apps/tasks-v0/test/v2_8-single-agent.test.js`'s test fixture
 * builds inline + what `apps/tasks-v0/src/Crew.js#createCrewAgent`
 * enriches post-construction. This file lives mobile-side until a
 * later phase trips the rule of two with desktop multi-crew launches
 * — at which point we lift into `apps/tasks-v0` proper as
 * `buildCrewState({meshAgent, crewConfig, localStoreBundle, ...})`.
 *
 * V1+ enrichment (chat, bot, metrics, calendar emission, invoicing)
 * lands in later phases — the slots are reserved here so the shape
 * is stable from day one:
 *   - chatController         (Phase 41.6 — appeal flow chat)
 *   - botAgentRegistry       (Phase 41.13 — cap-token bots)
 *   - metricsTracker         (Phase 41.x — observability)
 *   - notifierChannels       (Phase 41.11 — push)
 *   - onCalendarEmissionChange (Phase 41.12)
 *   - onCompensationChange   (Phase 41.x — invoicing)
 */

import { ItemStore } from '@canopy/item-store';
import { GroupManager } from '@canopy/core';
import { MemberMap } from '@canopy/identity-resolver';
import { buildStandardRolePolicy } from '@canopy-app/tasks-v0';
import {
  buildActorAliases,
  buildActorResolverFromMembers,
} from '@canopy-app/tasks-v0/ui/effectiveActor';
import { buildTasksSubstrateStack }   from '@canopy-app/tasks-v0/lib/substrateStack';
import { wireTasksSubstrateMirror }   from '@canopy-app/tasks-v0/substrateMirror';
import { registerAgentBundle }        from '@canopy/agent-registry';
import { classify, reverseResolve }   from '@canopy-app/tasks-v0/lib/podPathMap';

/** All four §II.2 storage policies — V0 tier used here. */
export const CREW_STORAGE_POLICIES = Object.freeze(
  ['no-pod', 'centralised', 'decentralised', 'hybrid'],
);

const KIND_DEFAULTS = Object.freeze({
  household:    { subtasksAdminApprovalDepth: 3 },
  project:      { subtasksAdminApprovalDepth: 4 },
  team:         { subtasksAdminApprovalDepth: 3 },
  friends:      { subtasksAdminApprovalDepth: 2 },
  maintenance:  { subtasksAdminApprovalDepth: 3 },
});

/**
 * @typedef {object} CrewMember
 * @property {string} webid
 * @property {string} [displayName]
 * @property {string} [pubKey]
 * @property {string} [role]
 *
 * @typedef {object} CrewConfig
 * @property {string} crewId
 * @property {string} name
 * @property {string} kind                      'household' | 'project' | 'team' | 'friends' | 'maintenance'
 * @property {Array<CrewMember>} members
 * @property {Array<{id: string, rank: number}>} [customRoles]
 * @property {number} [subtasksAdminApprovalDepth]
 *
 * @typedef {object} CrewState
 * @property {string} crewId                    getter delegating to liveCrew.crewId
 * @property {CrewConfig} liveCrew              frozen current config (mutated via crewMutator)
 * @property {(patch: object) => void} crewMutator
 * @property {Object<string, string>} roles     per-webid role map
 * @property {object} itemStore                 the per-crew ItemStore
 * @property {object} dataSource                CachingDataSource (per-crew rootContainer keeps isolation)
 * @property {object} members                   per-crew MemberMap
 * @property {object|null} chatController       wired in Phase 41.6
 * @property {object|null} botAgentRegistry     wired in Phase 41.13
 * @property {object|null} metricsTracker       wired in Phase 41.x
 * @property {object|null} notifierChannels     wired in Phase 41.11
 * @property {(() => void)|null} onCalendarEmissionChange   wired in Phase 41.12
 * @property {(() => void)|null} onCompensationChange       wired in Phase 41.x
 * @property {object|null} pseudoPod            M1-S3: per-crew pseudo-pod (best-effort)
 * @property {object|null} podRouting           M1-S3: per-crew pod-routing (best-effort)
 * @property {object|null} notifyEnvelope       M1-S3: per-crew notify-envelope (best-effort)
 * @property {object|null} agentRegistry        M1-S3: agent-registry handle (best-effort)
 * @property {object|null} tasksMirror          M1-S3: tasks substrate-mirror (best-effort)
 * @property {string|null} substrateDeviceId    M1-S3: device identifier for the substrate
 * @property {object|null} groupManager         M2-S8: per-crew GroupManager (issue/redeem invites)
 * @property {(() => Promise<object>)|null} onSpawn  M2-S8: server-side spawn hook (null on mobile)
 * @property {string} crewIdForOnboarding       M2-S8: crewId used as groupId for invites
 * @property {object} _podCtx                   M4 — pod-routing context.
 *   {classify, reverse, podRouting, crewId, vars, active}. classify +
 *   reverse pre-populated from Tasks podPathMap; podRouting + active
 *   filled by attachTasksBundle at sign-in (mirror of stoop c49c768).
 */

/**
 * Build a CrewState over the shared meshAgent's transports + identity.
 *
 * @param {object} args
 * @param {CrewConfig} args.crewConfig
 * @param {object} [args.localStoreBundle]   when provided, the
 *   ItemStore writes through `localStoreBundle.cache` so tasks
 *   survive restarts (per-crew rootContainer keeps isolation across
 *   crews). When omitted, an in-memory dataSource is used (tests).
 * @param {object} [args.meshAgent]  M1-S3 — when supplied, wires the
 *   substrate stack (pseudo-pod + pod-routing + notify-envelope) and
 *   registers the bundle with the agent-registry. Failures are
 *   swallowed so the crew remains functional even when the substrate
 *   is unavailable. Forward-courtesy seam for M4 `_podCtx` closure.
 * @returns {Promise<CrewState>}
 */
export async function buildCrewState({ crewConfig, localStoreBundle, meshAgent } = {}) {
  if (!crewConfig || typeof crewConfig.crewId !== 'string' || !crewConfig.crewId) {
    throw new TypeError('buildCrewState: crewConfig.crewId required');
  }
  const crew = _normaliseConfig(crewConfig);
  // M1-S1: normalized storage is available on crew.storage.


  const roles = Object.fromEntries(
    crew.members.map((m) => [m.webid, m.role ?? 'member']),
  );

  // Phase 41.18 follow-up — on mobile the agent dispatches with
  // `from = agent.pubKey` (no LocalUiAuth in the React path). Build
  // a pubKey → webid bridge so the role policy can resolve both
  // identifiers to the same role.
  //
  // Phase 52.11 migration — switched from the static `aliases` map
  // to an `actorResolver` (sync). Same data source (crew.members)
  // for V0; when `@canopy/agent-registry` is wired into mobile,
  // swap the resolver's data source for a sync cache over the
  // registry without touching `buildStandardRolePolicy`.
  //
  // `actorAliases` is still surfaced on the CrewState because
  // `resolveActorWebid` (relay-forwarded `_origin` resolution) +
  // `useActiveRole` hook consume it directly — those paths don't go
  // through `buildStandardRolePolicy`.
  const aliases       = buildActorAliases(crew.members);
  const actorResolver = buildActorResolverFromMembers(crew.members);

  const dataSource = localStoreBundle?.cache
    ?? (await _memorySource());

  const itemStore = new ItemStore({
    dataSource,
    rootContainer:        `mem://tasks/crews/${crew.crewId}/`,
    rolePolicy:           buildStandardRolePolicy(roles, { actorResolver }),
    enforceDependencies:  true,
  });

  const members = new MemberMap({ initial: crew.members });

  let liveCrew = Object.freeze(crew);
  const crewState = {
    get crewId()   { return liveCrew.crewId; },
    get liveCrew() { return liveCrew; },
    crewMutator(patch) {
      liveCrew = Object.freeze({ ...liveCrew, ...patch });
    },
    roles,
    // Phase 41.18 follow-up — pubKey → webid map for the role
    // resolver + UI consumers (`useActiveRole`). Mobile's dispatch
    // path's `from` is the agent's pubKey; this lets a single
    // identifier resolve to a role regardless of whether the caller
    // has the webid or the pubKey.
    actorAliases: aliases,
    itemStore,
    dataSource,
    members,
    // V1+ enrichment slots — wired by later phases.
    chatController:           null,
    botAgentRegistry:         null,
    metricsTracker:           null,
    notifierChannels:         null,
    onCalendarEmissionChange: null,
    onCompensationChange:     null,
    // M1-S3: substrate slots (best-effort wiring below).
    pseudoPod:         null,
    podRouting:        null,
    notifyEnvelope:    null,
    agentRegistry:     null,
    tasksMirror:       null,
    substrateDeviceId: null,
    // M2-S8: multi-crew onboarding-dispatch slots. Mirrors the
    // CrewState enrichment apps/tasks-v0/src/Crew.js (lines 374–377)
    // does for the web path. `buildMultiCrewOnboardingSkills`
    // (registered once in ServiceContext) reads these per call to
    // route issueInvite/redeemInvite to the right crew's GroupManager.
    // `onSpawn` stays null on mobile — the joining device generates
    // its own identity + passes `memberPubKey` to redeemInvite (no
    // server-side spawn hook), same as the CLI member-join path.
    groupManager:        null,
    onSpawn:             null,
    crewIdForOnboarding: crew.crewId,
    // M4: active pod-routing context. Populated with the Tasks
    // podPathMap classify/reverse functions so the innerKeyMap on
    // the shared local-store bundle can route logical keys to pod
    // URIs when a pod is attached. Starts inactive (active:false)
    // so no-pod operation is byte-neutral (pod-independence.md).
    // `attachTasksBundle` (called by ServiceContext.attachPod) fills
    // podRouting + crewId + sets active:true at sign-in time.
    _podCtx: {
      active:    false,
      classify,
      reverse:   reverseResolve,
      podRouting: null,   // filled by attachTasksBundle at sign-in
      crewId:    crew.crewId,
      vars:      {},
    },
  };

  // M2-S8: per-crew GroupManager for multi-crew onboarding dispatch.
  // Mirrors apps/tasks-v0/src/Crew.js (line 374) — built from the
  // same identity + vault that owns the meshAgent so issued invites
  // are signed by the crew admin's stable key. Best-effort: a crew
  // without a GroupManager simply can't issue/redeem invites (the
  // onboarding skills return a structured error), but the crew is
  // otherwise fully functional.
  if (meshAgent) {
    try {
      const id    = meshAgent.identity ?? null;
      const vault = id?.vault ?? id?._vault ?? null;
      if (id && vault) {
        crewState.groupManager = new GroupManager({ identity: id, vault });
      }
    } catch (err) {
      console.warn('[buildCrewState] GroupManager build failed:', err?.message ?? err);
    }
  }

  // M1-S3: Wire the substrate stack when a meshAgent is available.
  // Best-effort — any failure is swallowed so the crew works locally.
  if (meshAgent) {
    const substrateDeviceId = meshAgent.address ?? 'tasks-mobile-device';
    crewState.substrateDeviceId = substrateDeviceId;

    let tasksSubstrate = null;
    try {
      tasksSubstrate = buildTasksSubstrateStack({
        agent:    meshAgent,
        deviceId: substrateDeviceId,
      });
      crewState.pseudoPod      = tasksSubstrate.pseudoPod;
      crewState.podRouting     = tasksSubstrate.podRouting;
      crewState.notifyEnvelope = tasksSubstrate.notifyEnvelope;
      // M4: wire podRouting into _podCtx so attachTasksBundle can
      // activate routing without a separate ref lookup at sign-in time.
      if (crewState._podCtx && tasksSubstrate.podRouting) {
        crewState._podCtx.podRouting = tasksSubstrate.podRouting;
      }
    } catch (err) {
      console.warn('[buildCrewState] substrate stack failed:', err?.message ?? err);
    }

    // Register bundle capabilities with agent-registry.
    if (tasksSubstrate) {
      try {
        const regResult = registerAgentBundle(meshAgent, {
          capabilities: ['tasks', 'tasks-v0', `crew:${crew.crewId}`],
          pseudoPod:    tasksSubstrate.pseudoPod,
          podRouting:   tasksSubstrate.podRouting,
        });
        crewState.agentRegistry = regResult ?? true;
      } catch (err) {
        console.warn('[buildCrewState] registerAgentBundle failed:', err?.message ?? err);
      }
    }

    // Wire tasks substrate-mirror for cross-device fan-out.
    if (tasksSubstrate) {
      try {
        const peers = (crew.members ?? [])
          .filter((m) => m.pubKey && m.pubKey !== (meshAgent.address ?? null))
          .map((m) => ({ pubKey: m.pubKey }));
        const mirror = await wireTasksSubstrateMirror({
          itemStore:       crewState.itemStore,
          notifyEnvelope:  tasksSubstrate.notifyEnvelope,
          pseudoPod:       tasksSubstrate.pseudoPod,
          crewId:          crew.crewId,
          peers,
          selfPubKey:      meshAgent.address ?? null,
        });
        crewState.tasksMirror = mirror;
      } catch (err) {
        console.warn('[buildCrewState] wireTasksSubstrateMirror failed:', err?.message ?? err);
      }
    }
  }

  return crewState;
}

function _normaliseConfig(c) {
  const kind = c.kind ?? 'household';
  return {
    crewId:                     c.crewId,
    name:                       c.name ?? c.crewId,
    kind,
    members:                    Array.isArray(c.members) ? c.members : [],
    customRoles:                Array.isArray(c.customRoles) ? c.customRoles : [],
    subtasksAdminApprovalDepth: c.subtasksAdminApprovalDepth
      ?? KIND_DEFAULTS[kind]?.subtasksAdminApprovalDepth
      ?? 3,
    // M1-S1: §II.2 storage policy normalization. Mirrors
    // apps/tasks-v0/src/Crew.js#_normaliseStorage.
    storage: _normaliseStorage(c.storage),
    // Pass through other config fields so future-phase enrichment
    // sees them on liveCrew (calendarEmission, compensation,
    // availabilityHints, bot, pushPolicy, pushTokens, …).
    ...Object.fromEntries(
      Object.entries(c).filter(([k]) =>
        !['crewId', 'name', 'kind', 'members', 'customRoles',
          'subtasksAdminApprovalDepth', 'storage'].includes(k),
      ),
    ),
  };
}

/**
 * Normalise the §II.2 storage field. Accepts string shorthand or
 * structured `{policy, groupPodUri}`. Unknown policy strings fall
 * back to `'no-pod'`.
 *
 * Mirrors `apps/tasks-v0/src/Crew.js#_normaliseStorage`.
 */
function _normaliseStorage(raw) {
  if (raw == null) return { policy: 'no-pod', groupPodUri: null };
  if (typeof raw === 'string') {
    const policy = CREW_STORAGE_POLICIES.includes(raw) ? raw : 'no-pod';
    return { policy, groupPodUri: null };
  }
  if (typeof raw === 'object') {
    const policy = CREW_STORAGE_POLICIES.includes(raw.policy) ? raw.policy : 'no-pod';
    const groupPodUri = (typeof raw.groupPodUri === 'string' && raw.groupPodUri)
      ? raw.groupPodUri
      : null;
    return { policy, groupPodUri };
  }
  return { policy: 'no-pod', groupPodUri: null };
}

async function _memorySource() {
  const { MemorySource } = await import('@canopy/core');
  return new MemorySource();
}

/**
 * buildCircleState — minimum-viable per-circle state for the
 * single-agent topology.
 *
 * Phase 41.2 (2026-05-09).
 * M1-S1 (2026-05-18): `storage` field normalization — mirrors
 *   `apps/tasks-v0/src/Circle.js#_normaliseStorage`. All four §II.2
 *   policies accepted; V0 tier is the initial behaviour target.
 * M1-S3 (2026-05-18): substrate wiring (best-effort) when a
 *   `meshAgent` is supplied. Registers capabilities via
 *   `@onderling/agent-registry` and wires the tasks substrate-mirror.
 *   Forward-courtesy: `_podCtx: null` seam for M4.
 *
 * Mobile-local helper for now. The shape mirrors what
 * `apps/tasks-v0/test/v2_8-single-agent.test.js`'s test fixture
 * builds inline + what `apps/tasks-v0/src/Circle.js#createCircleAgent`
 * enriches post-construction. This file lives mobile-side until a
 * later phase trips the rule of two with desktop multi-circle launches
 * — at which point we lift into `apps/tasks-v0` proper as
 * `buildCircleState({meshAgent, circleConfig, localStoreBundle, ...})`.
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

import { CircleItemStore, createTaskStore } from '@onderling/item-store';
import { GroupManager } from '@onderling/core';
import { MemberMap } from '@onderling/identity-resolver';
import { buildStandardRolePolicy } from '@onderling-app/tasks';
import {
  buildActorAliases,
  buildActorResolverFromMembers,
} from '@onderling-app/tasks/ui/effectiveActor';
import { buildTasksSubstrateStack }   from '@onderling-app/tasks/lib/substrateStack';
import { wireTasksSubstrateMirror }   from '@onderling-app/tasks/substrateMirror';
import { registerAgentBundle }        from '@onderling/agent-registry';
import { classify, reverseResolve }   from '@onderling-app/tasks/lib/podPathMap';

/** All four §II.2 storage policies — V0 tier used here. */
export const CIRCLE_STORAGE_POLICIES = Object.freeze(
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
 * @typedef {object} CircleMember
 * @property {string} webid
 * @property {string} [displayName]
 * @property {string} [pubKey]
 * @property {string} [role]
 *
 * @typedef {object} CircleConfig
 * @property {string} circleId
 * @property {string} name
 * @property {string} kind                      'household' | 'project' | 'team' | 'friends' | 'maintenance'
 * @property {Array<CircleMember>} members
 * @property {Array<{id: string, rank: number}>} [customRoles]
 * @property {number} [subtasksAdminApprovalDepth]
 *
 * @typedef {object} CircleState
 * @property {string} circleId                    getter delegating to liveCircle.circleId
 * @property {CircleConfig} liveCircle              frozen current config (mutated via circleMutator)
 * @property {(patch: object) => void} circleMutator
 * @property {Object<string, string>} roles     per-webid role map
 * @property {object} itemStore                 the per-circle ItemStore
 * @property {object} dataSource                CachingDataSource (per-circle rootContainer keeps isolation)
 * @property {object} members                   per-circle MemberMap
 * @property {object|null} chatController       wired in Phase 41.6
 * @property {object|null} botAgentRegistry     wired in Phase 41.13
 * @property {object|null} metricsTracker       wired in Phase 41.x
 * @property {object|null} notifierChannels     wired in Phase 41.11
 * @property {(() => void)|null} onCalendarEmissionChange   wired in Phase 41.12
 * @property {(() => void)|null} onCompensationChange       wired in Phase 41.x
 * @property {object|null} pseudoPod            M1-S3: per-circle pseudo-pod (best-effort)
 * @property {object|null} podRouting           M1-S3: per-circle pod-routing (best-effort)
 * @property {object|null} notifyEnvelope       M1-S3: per-circle notify-envelope (best-effort)
 * @property {object|null} agentRegistry        M1-S3: agent-registry handle (best-effort)
 * @property {object|null} tasksMirror          M1-S3: tasks substrate-mirror (best-effort)
 * @property {string|null} substrateDeviceId    M1-S3: device identifier for the substrate
 * @property {object|null} groupManager         M2-S8: per-circle GroupManager (issue/redeem invites)
 * @property {(() => Promise<object>)|null} onSpawn  M2-S8: server-side spawn hook (null on mobile)
 * @property {string} circleIdForOnboarding       M2-S8: circleId used as groupId for invites
 * @property {object} _podCtx                   M4 — pod-routing context.
 *   {classify, reverse, podRouting, circleId, vars, active}. classify +
 *   reverse pre-populated from Tasks podPathMap; podRouting + active
 *   filled by attachTasksBundle at sign-in (mirror of stoop c49c768).
 */

/**
 * Build a CircleState over the shared meshAgent's transports + identity.
 *
 * @param {object} args
 * @param {CircleConfig} args.circleConfig
 * @param {object} [args.localStoreBundle]   when provided, the
 *   ItemStore writes through `localStoreBundle.cache` so tasks
 *   survive restarts (per-circle rootContainer keeps isolation across
 *   circles). When omitted, an in-memory dataSource is used (tests).
 * @param {object} [args.meshAgent]  M1-S3 — when supplied, wires the
 *   substrate stack (pseudo-pod + pod-routing + notify-envelope) and
 *   registers the bundle with the agent-registry. Failures are
 *   swallowed so the circle remains functional even when the substrate
 *   is unavailable. Forward-courtesy seam for M4 `_podCtx` closure.
 * @returns {Promise<CircleState>}
 */
export async function buildCircleState({ circleConfig, localStoreBundle, meshAgent } = {}) {
  if (!circleConfig || typeof circleConfig.circleId !== 'string' || !circleConfig.circleId) {
    throw new TypeError('buildCircleState: circleConfig.circleId required');
  }
  const circle = _normaliseConfig(circleConfig);
  // M1-S1: normalized storage is available on circle.storage.


  const roles = Object.fromEntries(
    circle.members.map((m) => [m.webid, m.role ?? 'member']),
  );

  // Phase 41.18 follow-up — on mobile the agent dispatches with
  // `from = agent.pubKey` (no LocalUiAuth in the React path). Build
  // a pubKey → webid bridge so the role policy can resolve both
  // identifiers to the same role.
  //
  // Phase 52.11 migration — switched from the static `aliases` map
  // to an `actorResolver` (sync). Same data source (circle.members)
  // for V0; when `@onderling/agent-registry` is wired into mobile,
  // swap the resolver's data source for a sync cache over the
  // registry without touching `buildStandardRolePolicy`.
  //
  // `actorAliases` is still surfaced on the CircleState because
  // `resolveActorWebid` (relay-forwarded `_origin` resolution) +
  // `useActiveRole` hook consume it directly — those paths don't go
  // through `buildStandardRolePolicy`.
  const aliases       = buildActorAliases(circle.members);
  const actorResolver = buildActorResolverFromMembers(circle.members);

  const dataSource = localStoreBundle?.cache
    ?? (await _memorySource());

  // migration step 3 (2026-07-18): converged `CircleItemStore` +
  // `createTaskStore` compat surface, threading the same per-circle rolePolicy
  // + enforceDependencies the class ItemStore took (mirrors apps/tasks-v0).
  const circleStore = new CircleItemStore({
    dataSource,
    rootContainer:        `mem://tasks/circles/${circle.circleId}/`,
  });
  const itemStore = createTaskStore(circleStore, {
    rolePolicy:           buildStandardRolePolicy(roles, { actorResolver }),
    enforceDependencies:  true,
  });

  const members = new MemberMap({ initial: circle.members });

  let liveCircle = Object.freeze(circle);
  const circleState = {
    get circleId()   { return liveCircle.circleId; },
    get liveCircle() { return liveCircle; },
    circleMutator(patch) {
      liveCircle = Object.freeze({ ...liveCircle, ...patch });
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
    // M2-S8: multi-circle onboarding-dispatch slots. Mirrors the
    // CircleState enrichment apps/tasks-v0/src/Circle.js (lines 374–377)
    // does for the web path. `buildMultiCircleOnboardingSkills`
    // (registered once in ServiceContext) reads these per call to
    // route issueInvite/redeemInvite to the right circle's GroupManager.
    // `onSpawn` stays null on mobile — the joining device generates
    // its own identity + passes `memberPubKey` to redeemInvite (no
    // server-side spawn hook), same as the CLI member-join path.
    groupManager:        null,
    onSpawn:             null,
    circleIdForOnboarding: circle.circleId,
    // M4: active pod-routing context. Populated with the Tasks
    // podPathMap classify/reverse functions so the innerKeyMap on
    // the shared local-store bundle can route logical keys to pod
    // URIs when a pod is attached. Starts inactive (active:false)
    // so no-pod operation is byte-neutral (pod-independence.md).
    // `attachTasksBundle` (called by ServiceContext.attachPod) fills
    // podRouting + circleId + sets active:true at sign-in time.
    _podCtx: {
      active:    false,
      classify,
      reverse:   reverseResolve,
      podRouting: null,   // filled by attachTasksBundle at sign-in
      circleId:    circle.circleId,
      vars:      {},
    },
  };

  // M2-S8: per-circle GroupManager for multi-circle onboarding dispatch.
  // Mirrors apps/tasks-v0/src/Circle.js (line 374) — built from the
  // same identity + vault that owns the meshAgent so issued invites
  // are signed by the circle admin's stable key. Best-effort: a circle
  // without a GroupManager simply can't issue/redeem invites (the
  // onboarding skills return a structured error), but the circle is
  // otherwise fully functional.
  if (meshAgent) {
    try {
      const id    = meshAgent.identity ?? null;
      const vault = id?.vault ?? id?._vault ?? null;
      if (id && vault) {
        circleState.groupManager = new GroupManager({ identity: id, vault });
      }
    } catch (err) {
      console.warn('[buildCircleState] GroupManager build failed:', err?.message ?? err);
    }
  }

  // M1-S3: Wire the substrate stack when a meshAgent is available.
  // Best-effort — any failure is swallowed so the circle works locally.
  if (meshAgent) {
    const substrateDeviceId = meshAgent.address ?? 'tasks-mobile-device';
    circleState.substrateDeviceId = substrateDeviceId;

    let tasksSubstrate = null;
    try {
      tasksSubstrate = buildTasksSubstrateStack({
        agent:    meshAgent,
        deviceId: substrateDeviceId,
      });
      circleState.pseudoPod      = tasksSubstrate.pseudoPod;
      circleState.podRouting     = tasksSubstrate.podRouting;
      circleState.notifyEnvelope = tasksSubstrate.notifyEnvelope;
      // M4: wire podRouting into _podCtx so attachTasksBundle can
      // activate routing without a separate ref lookup at sign-in time.
      if (circleState._podCtx && tasksSubstrate.podRouting) {
        circleState._podCtx.podRouting = tasksSubstrate.podRouting;
      }
    } catch (err) {
      console.warn('[buildCircleState] substrate stack failed:', err?.message ?? err);
    }

    // Register bundle capabilities with agent-registry.
    if (tasksSubstrate) {
      try {
        const regResult = registerAgentBundle(meshAgent, {
          capabilities: ['tasks', 'tasks-v0', `circle:${circle.circleId}`],
          pseudoPod:    tasksSubstrate.pseudoPod,
          podRouting:   tasksSubstrate.podRouting,
        });
        circleState.agentRegistry = regResult ?? true;
      } catch (err) {
        console.warn('[buildCircleState] registerAgentBundle failed:', err?.message ?? err);
      }
    }

    // Wire tasks substrate-mirror for cross-device fan-out.
    if (tasksSubstrate) {
      try {
        const peers = (circle.members ?? [])
          .filter((m) => m.pubKey && m.pubKey !== (meshAgent.address ?? null))
          .map((m) => ({ pubKey: m.pubKey }));
        const mirror = await wireTasksSubstrateMirror({
          itemStore:       circleState.itemStore,
          notifyEnvelope:  tasksSubstrate.notifyEnvelope,
          pseudoPod:       tasksSubstrate.pseudoPod,
          circleId:          circle.circleId,
          peers,
          selfPubKey:      meshAgent.address ?? null,
        });
        circleState.tasksMirror = mirror;
      } catch (err) {
        console.warn('[buildCircleState] wireTasksSubstrateMirror failed:', err?.message ?? err);
      }
    }
  }

  return circleState;
}

function _normaliseConfig(c) {
  const kind = c.kind ?? 'household';
  return {
    circleId:                     c.circleId,
    name:                       c.name ?? c.circleId,
    kind,
    members:                    Array.isArray(c.members) ? c.members : [],
    customRoles:                Array.isArray(c.customRoles) ? c.customRoles : [],
    subtasksAdminApprovalDepth: c.subtasksAdminApprovalDepth
      ?? KIND_DEFAULTS[kind]?.subtasksAdminApprovalDepth
      ?? 3,
    // M1-S1: §II.2 storage policy normalization. Mirrors
    // apps/tasks-v0/src/Circle.js#_normaliseStorage.
    storage: _normaliseStorage(c.storage),
    // Pass through other config fields so future-phase enrichment
    // sees them on liveCircle (calendarEmission, compensation,
    // availabilityHints, bot, pushPolicy, pushTokens, …).
    ...Object.fromEntries(
      Object.entries(c).filter(([k]) =>
        !['circleId', 'name', 'kind', 'members', 'customRoles',
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
 * Mirrors `apps/tasks-v0/src/Circle.js#_normaliseStorage`.
 */
function _normaliseStorage(raw) {
  if (raw == null) return { policy: 'no-pod', groupPodUri: null };
  if (typeof raw === 'string') {
    const policy = CIRCLE_STORAGE_POLICIES.includes(raw) ? raw : 'no-pod';
    return { policy, groupPodUri: null };
  }
  if (typeof raw === 'object') {
    const policy = CIRCLE_STORAGE_POLICIES.includes(raw.policy) ? raw.policy : 'no-pod';
    const groupPodUri = (typeof raw.groupPodUri === 'string' && raw.groupPodUri)
      ? raw.groupPodUri
      : null;
    return { policy, groupPodUri };
  }
  return { policy: 'no-pod', groupPodUri: null };
}

async function _memorySource() {
  const { MemorySource } = await import('@onderling/core');
  return new MemorySource();
}

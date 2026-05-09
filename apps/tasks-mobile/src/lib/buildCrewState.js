/**
 * buildCrewState — minimum-viable per-crew state for the V2.8
 * single-agent topology.
 *
 * Phase 41.2 (2026-05-09).
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
import { MemberMap } from '@canopy/identity-resolver';
import { buildStandardRolePolicy } from '@canopy-app/tasks-v0';

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
 * @returns {Promise<CrewState>}
 */
export async function buildCrewState({ crewConfig, localStoreBundle } = {}) {
  if (!crewConfig || typeof crewConfig.crewId !== 'string' || !crewConfig.crewId) {
    throw new TypeError('buildCrewState: crewConfig.crewId required');
  }
  const crew = _normaliseConfig(crewConfig);

  const roles = Object.fromEntries(
    crew.members.map((m) => [m.webid, m.role ?? 'member']),
  );

  const dataSource = localStoreBundle?.cache
    ?? (await _memorySource());

  const itemStore = new ItemStore({
    dataSource,
    rootContainer:        `mem://tasks/crews/${crew.crewId}/`,
    rolePolicy:           buildStandardRolePolicy(roles),
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
  };

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
    // Pass through other config fields so future-phase enrichment
    // sees them on liveCrew (calendarEmission, compensation,
    // availabilityHints, bot, pushPolicy, pushTokens, …).
    ...Object.fromEntries(
      Object.entries(c).filter(([k]) =>
        !['crewId', 'name', 'kind', 'members', 'customRoles', 'subtasksAdminApprovalDepth'].includes(k),
      ),
    ),
  };
}

async function _memorySource() {
  const { MemorySource } = await import('@canopy/core');
  return new MemorySource();
}

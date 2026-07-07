/**
 * `buildMultiCrewRuntime` — in-process tasks-v0 multi-crew runtime.
 *
 * Extracted 2026-05-20 from `test/v2-multi-crew.test.js`'s
 * `buildMultiCrew()` fixture so that:
 *   - the existing v2-multi-crew test suite continues to drive it
 *     end-to-end;
 *   - the SP-4b "tasks-v0 multi-crew through manifest-host" proof
 *     (`test/manifest-host-mount.test.js`) reuses it;
 *   - the SP-11 recombination demo (`examples/manifest-host-demo/`)
 *     reuses it too.
 *
 * Mirrors `bin/tasks-ui.js --multi-crew` (lines 332–414) but without
 * the CLI option parsing, TTY attachment, web-UI mount, or Telegram
 * bridge.  Pure in-process: identity is generated, transport is the
 * mesh's internal bus, storage is in-memory.
 *
 * Returns the four primitives every consumer needs:
 *
 *   { meshAgent, primaryBundle, crewsMap, localStoreBundle,
 *     spawnCrewInProcess }
 *
 * - `meshAgent` — the single shared agent that owns the skill registry.
 * - `primaryBundle` — the primary-crew bundle from `createCrewAgent`.
 * - `crewsMap` — `Map<circleId, CrewState>` the bundleResolver picks from.
 * - `localStoreBundle` — backing storage (shared across crews).
 * - `spawnCrewInProcess(circleId)` — in-process sibling-crew spawner,
 *   already stashed on every CrewState via `._spawnCrewInProcess`.
 *
 * After this returns, `meshAgent.start()` has been awaited; skills
 * are registered; multi-crew dispatch is live.
 */

import { buildMeshAgent } from './MeshAgent.js';
import { createCrewAgent } from './Crew.js';
import { buildBundle } from './storage/buildBundle.js';
import { wireSkills } from './wireSkills.js';
import { multiCrewResolver } from './bundleResolver.js';
import { buildMultiCrewOnboardingSkills } from './skills/multiCrewOnboarding.js';

const DEFAULT_ANNE = 'https://id.example/anne';

/**
 * @param {object} [opts]
 * @param {string} [opts.primaryCircleId='primary-crew']
 * @param {string} [opts.primaryCrewName='Primary']
 * @param {string} [opts.primaryCrewKind='project']
 * @param {Array<{webid: string, displayName: string, role: string}>}
 *           [opts.primaryMembers]
 * @param {string} [opts.label='tasks-multi-crew']
 * @param {object} [opts.localStoreBundle]
 *           Optional caller-supplied bundle; defaults to `buildBundle()`.
 */
export async function buildMultiCrewRuntime({
  primaryCircleId   = 'primary-crew',
  primaryCrewName = 'Primary',
  primaryCrewKind = 'project',
  primaryMembers  = [{ webid: DEFAULT_ANNE, displayName: 'Anne', role: 'admin' }],
  label           = 'tasks-multi-crew',
  localStoreBundle = buildBundle(),
} = {}) {
  const { meshAgent, identity } = await buildMeshAgent({
    localStoreBundle,
    label,
  });

  const primaryConfig = {
    circleId:  primaryCircleId,
    name:    primaryCrewName,
    kind:    primaryCrewKind,
    members: primaryMembers,
  };

  const primaryBundle = await createCrewAgent({
    crewConfig:           primaryConfig,
    localStoreBundle,
    identity,
    transport:            meshAgent.transport,
    agent:                meshAgent,
    registerSkills:       false,   // wireSkills owns registration below
    wireOnboardingSkills: false,
  });
  const primaryCrewState = primaryBundle._crewState;
  const crewsMap = new Map([[primaryCrewState.circleId, primaryCrewState]]);

  async function spawnCrewInProcess(circleId) {
    if (crewsMap.has(circleId)) return crewsMap.get(circleId);
    const path = `mem://tasks/crews/${circleId}/config.json`;
    const raw  = await localStoreBundle.cache.read(path);
    if (!raw) throw new Error(`no saved config at ${path}`);
    const cfg  = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const spawned = await createCrewAgent({
      crewConfig:           cfg,
      localStoreBundle,
      identity,
      transport:            meshAgent.transport,
      agent:                meshAgent,
      registerSkills:       false,
      wireOnboardingSkills: false,
    });
    const cs = spawned._crewState;
    cs._spawnCrewInProcess = spawnCrewInProcess;
    crewsMap.set(cfg.circleId, cs);
    return cs;
  }
  primaryCrewState._spawnCrewInProcess = spawnCrewInProcess;

  wireSkills({
    meshAgent,
    bundleResolver: multiCrewResolver(crewsMap),
    crewsProvider:  () => crewsMap.values(),
    members:        primaryBundle.members,
  });

  for (const def of buildMultiCrewOnboardingSkills({
    bundleResolver: multiCrewResolver(crewsMap),
  })) {
    meshAgent.skills.register(def);
  }

  await meshAgent.start();

  return {
    meshAgent,
    primaryBundle,
    crewsMap,
    localStoreBundle,
    spawnCrewInProcess,
  };
}

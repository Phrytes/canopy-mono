/**
 * TasksAgent — composition of substrates for H4 V0.
 *
 * Wires:
 *   - `core.Agent` from `@canopy/core` — real SkillRegistry + dispatch.
 *     No synthetic `{invokeSkill}` shim (deleted in L1d Phase 3.1, 2026-05-04).
 *   - L1b ItemStore (open/closed tasks, audit, role-policy gate at the
 *     item level via `buildStandardRolePolicy(roles)`)
 *   - L1h MemberMap (webid ↔ external-id resolution; resolveMember skill)
 *   - L1e SkillMatch (claim flow via pubsub-of-skills) — optional
 *   - L1f Notifier (deadline reminders, daily digest) — optional
 *
 * Apps that want HTTP exposure call `mountLocalUi(bundle.agent)` from
 * `@canopy/agent-ui`; that wraps `core.A2ATransport` on 127.0.0.1.
 *
 * The bundle no longer exposes `broadcaster` / `buildRouter` / `skills`
 * map — apps that need event fan-out subscribe to `itemStore` directly
 * (it extends `core.Emitter`).
 */

import {
  Agent,
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
  MemorySource,
} from '@canopy/core';
import { ItemStore } from '@canopy/item-store';
import { MemberMap, buildIdentitySkills }             from '@canopy/identity-resolver';
import { SkillMatch }                                 from '@canopy/skill-match';

import { buildStandardRolePolicy } from './rolePolicy.js';
import { buildSkills } from './skills/index.js';

/**
 * High-level tasks-agent factory.
 *
 * @param {object} args
 * @param {object} [args.itemBackend]                   Backend for ItemStore (defaults to InMemoryBackend)
 * @param {Object<string, string>} args.roles           `{webid: standardRole}` for the role policy
 * @param {Array<object>} [args.members]                initial member list for MemberMap (used when `pod` is not supplied)
 * @param {object} [args.pod]                           pod-backed roster (alternative to `members`)
 * @param {object} args.pod.client                      duck-typed PodClient with `.read(uri, {decode}) → {content}`
 * @param {string} args.pod.configUri                   pod URI of the household config blob (members live under `members[]`)
 * @param {Array<object>} [args.pod.fallback]           used iff config read returns NOT_FOUND (typical bootstrap-time)
 * @param {object} [args.skillMatch]                    `{transport, group, localActor?}` — optional
 * @param {object} [args.notifier]                      pre-configured Notifier — optional
 * @param {object} [args.identity]                      pre-built AgentIdentity (tests)
 * @param {object} [args.transport]                     transport for `core.Agent` (default: InternalTransport)
 * @param {string} [args.label='TasksAgent']
 * @returns {Promise<{
 *   agent:      Agent,
 *   itemStore:  ItemStore,
 *   members:    MemberMap,
 *   notifier:   object | null,
 *   skillMatch: SkillMatch | null,
 * }>}
 */
export async function createTasksAgent({
  itemBackend,
  roles,
  members:    initialMembers,
  pod:        podCfg,
  skillMatch: skillMatchOpts,
  notifier:   providedNotifier,
  identity,
  transport,
  label = 'TasksAgent',
}) {
  if (!roles || typeof roles !== 'object') {
    throw new TypeError('createTasksAgent: roles map required');
  }
  if (podCfg && initialMembers) {
    throw new TypeError('createTasksAgent: pass either `pod` or `members`, not both');
  }

  // ── Substrates ─────────────────────────────────────────────────────────────
  const policy    = buildStandardRolePolicy(roles);
  const dataSource = itemBackend ?? new MemorySource();
  const itemStore = new ItemStore({ dataSource, rootContainer: 'mem://tasks/', rolePolicy: policy });

  // Member roster: pod-config-backed (Phase 4.1 contract) when `pod` is
  // supplied; hand-built array otherwise. The two paths are mutually
  // exclusive at the API level — using both at once is almost always a
  // bug (the array would be silently shadowed).
  const members = podCfg
    ? await MemberMap.fromPodConfig({
        podClient: podCfg.client,
        configUri: podCfg.configUri,
        fallback:  podCfg.fallback,
      })
    : new MemberMap({ initial: initialMembers ?? [] });

  const notifier = providedNotifier ?? null;

  // ── Real core.Agent ────────────────────────────────────────────────────────
  const id  = identity ?? await AgentIdentity.generate(new VaultMemory());
  const tx  = transport ?? new InternalTransport(new InternalBus(), id.pubKey);
  const agent = new Agent({ identity: id, transport: tx, label });

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

  for (const def of buildIdentitySkills({ members })) agent.skills.register(def);
  for (const def of buildSkills({ store: itemStore }))  agent.skills.register(def);

  await agent.start();

  return {
    agent,
    itemStore,
    members,
    notifier,
    skillMatch,
  };
}

export { buildStandardRolePolicy } from './rolePolicy.js';
export { computeStatus, detectCycle } from './dag.js';

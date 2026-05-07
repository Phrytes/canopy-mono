/**
 * H4 skill definitions — `defineSkill` shape.
 *
 * Migrated 2026-05-04 from the legacy `(args, ctx) => result` shape (which
 * required the `composeAgent` synthetic-agent shim) to the SDK-native
 * `({parts, from, agent}) => Parts[]` shape.  Handlers register on a real
 * `core.Agent` and dispatch via `core.taskExchange.handleTaskRequest`.
 *
 * Wire convention: each skill takes a single `DataPart` whose `data`
 * field carries the JSON args, and returns a JSON object that
 * SkillRegistry auto-wraps into a single `DataPart` on the way out.
 *
 * `from` carries the caller's identifier (the actor webid).  Skill
 * matching for skill-tagged tasks remains via L1e SkillMatch.
 *
 * `resolveMember` lives in `@canopy/identity-resolver`'s
 * `buildIdentitySkills` and is registered alongside these by Agent.js.
 */

import { defineSkill } from '@canopy/core';
import { computeStatus, detectCycle } from '../dag.js';

/** Read the first DataPart's `data` from a Parts[] input. Defaults to `{}`. */
function dataArgs(parts) {
  if (!Array.isArray(parts)) return {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

/**
 * @param {object} args
 * @param {import('@canopy/item-store').ItemStore} args.store
 * @returns {Array<object>} array of `defineSkill` definitions
 */
export function buildSkills({ store }) {
  return [
    /**
     * addTask({type='task', text, notes?, dependencies?, requiredSkills?, dueAt?, visibility?})
     * Validates DAG cycle-free.  Returns the persisted task.
     */
    defineSkill('addTask', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const partial = {
        type:           a.type ?? 'task',
        text:           a.text,
        ...(a.notes          !== undefined ? { notes:          a.notes }          : {}),
        ...(a.dependencies   !== undefined ? { dependencies:   a.dependencies }   : {}),
        ...(a.requiredSkills !== undefined ? { requiredSkills: a.requiredSkills } : {}),
        ...(a.dueAt          !== undefined ? { dueAt:          a.dueAt }          : {}),
        ...(a.visibility     !== undefined ? { visibility:     a.visibility }     : {}),
      };
      // DAG cycle detection (Q-H4.8).
      if (Array.isArray(partial.dependencies) && partial.dependencies.length > 0) {
        const all = await store.listOpen();
        const cycle = detectCycle({ id: '__new__', dependencies: partial.dependencies }, all);
        if (cycle) {
          throw Object.assign(
            new Error(`addTask: dependency cycle would form: ${cycle.join(' → ')}`),
            { code: 'DEPENDENCY_CYCLE', cycle },
          );
        }
      }
      const [task] = await store.addItems([partial], { actor: from });
      return { task };
    }, {
      description: 'Create a task; rejects on dependency cycles.',
      visibility:  'authenticated',
    }),

    /**
     * claimTask({id})
     * Compare-and-swap; loser gets `{error: 'already-claimed', current}`.
     */
    defineSkill('claimTask', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const result = await store.claim(a.id, { actor: from });
      return { result };
    }, {
      description: 'Compare-and-swap claim a task.',
      visibility:  'authenticated',
    }),

    /**
     * completeTask({id})
     */
    defineSkill('completeTask', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const [completed] = await store.markComplete([{ id: a.id }], { actor: from });
      return { task: completed };
    }, {
      description: 'Mark a task complete.',
      visibility:  'authenticated',
    }),

    /**
     * reassignTask({id, newAssignee})
     * Role-policy-gated (admin / coordinator only per buildStandardRolePolicy).
     * Gating is enforced inside ItemStore via the rolePolicy passed at construction.
     */
    defineSkill('reassignTask', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const updated = await store.reassign(a.id, a.newAssignee ?? null, { actor: from });
      return { task: updated };
    }, {
      description: 'Reassign a task — admin/coordinator only via item-store role policy.',
      visibility:  'authenticated',
    }),

    /**
     * removeTask({id})  — admin-only per role policy
     */
    defineSkill('removeTask', async ({ parts, from }) => {
      const a = dataArgs(parts);
      const [id] = await store.removeItems([{ id: a.id }], { actor: from });
      return { id };
    }, {
      description: 'Remove a task — admin only via item-store role policy.',
      visibility:  'authenticated',
    }),

    /**
     * listOpen({type?, requiredSkill?, assignee?, status?})
     * Returns items + computed `status` (ready/waiting/blocked).
     */
    defineSkill('listOpen', async ({ parts }) => {
      const a = dataArgs(parts);
      const filter = {};
      if (a.type)          filter.type          = a.type;
      if (a.requiredSkill) filter.requiredSkill = a.requiredSkill;
      if ('assignee' in a) filter.assignee      = a.assignee;
      const open   = await store.listOpen(filter);
      const closed = await store.listClosed();
      const items  = open.map((t) => ({ ...t, status: computeStatus(t, open, closed) }));
      const filtered = a.status ? items.filter((t) => t.status === a.status) : items;
      return { items: filtered };
    }, {
      description: 'List open tasks with computed status; filters: type/requiredSkill/assignee/status.',
      visibility:  'authenticated',
    }),

    /**
     * listMine({})  — open tasks assigned to the calling actor.
     */
    defineSkill('listMine', async ({ from }) => {
      const items = await store.listOpen({ assignee: from });
      return { items };
    }, {
      description: 'List open tasks assigned to the calling actor.',
      visibility:  'authenticated',
    }),

    /**
     * listClaimable({skill?})  — unassigned tasks (optionally skill-filtered).
     */
    defineSkill('listClaimable', async ({ parts }) => {
      const a = dataArgs(parts);
      const filter = { assignee: null };
      if (a.skill) filter.requiredSkill = a.skill;
      const items = await store.listOpen(filter);
      return { items };
    }, {
      description: 'List unassigned tasks; optional `skill` filter.',
      visibility:  'authenticated',
    }),
  ];
}

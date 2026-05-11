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
 * V2.8: skill bodies resolve a per-crew CrewState via `bundleResolver`
 * at dispatch time. Single registration on the process-wide meshAgent.
 *
 * `from` carries the caller's identifier (the actor webid).  Skill
 * matching for skill-tagged tasks remains via L1e SkillMatch.
 *
 * `resolveMember` lives in `@canopy/identity-resolver`'s
 * `buildIdentitySkills` and is registered alongside these by wireSkills.
 */

import { defineSkill } from '@canopy/core';
import { computeStatus, effectiveStatus, unmetDeps, detectCycle } from '../dag.js';
import { argsFromParts } from '../bundleResolver.js';
import { validateCanonical } from '@canopy/item-types';

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 * @returns {Array<object>} array of `defineSkill` definitions
 */
export function buildSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildSkills: bundleResolver(parts, ctx) required');
  }

  return [
    /**
     * addTask({type='task', text, notes?, dependencies?, requiredSkills?, dueAt?, visibility?})
     * Validates DAG cycle-free.  Returns the persisted task.
     */
    defineSkill('addTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      // Phase 10 — block addTask when the crew is paused or archived.
      const lc = crew.liveCrew;
      if (lc?.archived) return { error: 'crew-archived' };
      if (lc?.paused)   return { error: 'crew-paused' };

      const a = argsFromParts(parts);
      const partial = {
        type:           a.type ?? 'task',
        text:           a.text,
        ...(a.notes          !== undefined ? { notes:          a.notes }          : {}),
        ...(a.dependencies   !== undefined ? { dependencies:   a.dependencies }   : {}),
        ...(a.requiredSkills !== undefined ? { requiredSkills: a.requiredSkills } : {}),
        ...(a.dueAt          !== undefined ? { dueAt:          a.dueAt }          : {}),
        ...(a.visibility     !== undefined ? { visibility:     a.visibility }     : {}),
        // Phase 5 DoD-lifecycle fields (all optional; substrate honours them).
        ...(a.definitionOfDone !== undefined ? { definitionOfDone: a.definitionOfDone } : {}),
        ...(a.approval         !== undefined ? { approval:         a.approval         } : {}),
        ...(a.master           !== undefined ? { master:           a.master           } : {}),
        ...(a.parentTaskId     !== undefined ? { parentTaskId:     a.parentTaskId     } : {}),
        // V2 task fields (auto-scheduling V2.4 + invoicing V2.2).
        ...(a.scheduledAt      !== undefined ? { scheduledAt:      a.scheduledAt     } : {}),
        ...(a.estimateMinutes  !== undefined ? { estimateMinutes:  a.estimateMinutes } : {}),
      };
      // DAG cycle detection (Q-H4.8).
      if (Array.isArray(partial.dependencies) && partial.dependencies.length > 0) {
        const all = await crew.itemStore.listOpen();
        const cycle = detectCycle({ id: '__new__', dependencies: partial.dependencies }, all);
        if (cycle) {
          throw Object.assign(
            new Error(`addTask: dependency cycle would form: ${cycle.join(' → ')}`),
            { code: 'DEPENDENCY_CYCLE', cycle },
          );
        }
      }
      const [task] = await crew.itemStore.addItems([partial], { actor: from, actorDisplayName });

      // Phase 52.7 — warn-only canonical-shape validation. Adoption is
      // observational at first: the substrate flags drift but never blocks
      // a write (existing data + forward-additive policy).
      try {
        const v = validateCanonical(task);
        if (!v.ok) console.warn('item-types[task]:', JSON.stringify(v.errors));
      } catch { /* validator outage must not break writes */ }

      return { task };
    }, {
      description: 'Create a task; rejects on dependency cycles. Blocked when crew is paused/archived.',
      visibility:  'authenticated',
    }),

    /**
     * claimTask({id})
     * Compare-and-swap; loser gets `{error: 'already-claimed', current}`.
     */
    defineSkill('claimTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const result = await crew.itemStore.claim(a.id, { actor: from, actorDisplayName });
      return { result };
    }, {
      description: 'Compare-and-swap claim a task.',
      visibility:  'authenticated',
    }),

    /**
     * completeTask({id})
     */
    defineSkill('completeTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      try {
        const [completed] = await crew.itemStore.markComplete(
          [{ id: a.id }],
          { actor: from, actorDisplayName },
        );
        return { task: completed };
      } catch (err) {
        // V2.7 — translate the substrate's DependenciesOpenError into
        // a structured error the UI / bot can render usefully.
        if (err?.code === 'DEPENDENCIES_OPEN') {
          return { error: 'has-open-dependencies', openDeps: err.openDeps };
        }
        throw err;
      }
    }, {
      description: 'Mark a task complete.',
      visibility:  'authenticated',
    }),

    /**
     * reassignTask({id, newAssignee})
     * Role-policy-gated (admin / coordinator only per buildStandardRolePolicy).
     * Gating is enforced inside ItemStore via the rolePolicy passed at construction.
     */
    defineSkill('reassignTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const updated = await crew.itemStore.reassign(a.id, a.newAssignee ?? null, { actor: from, actorDisplayName });
      return { task: updated };
    }, {
      description: 'Reassign a task — admin/coordinator only via item-store role policy.',
      visibility:  'authenticated',
    }),

    /**
     * removeTask({id})  — admin-only per role policy
     */
    defineSkill('removeTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const [id] = await crew.itemStore.removeItems([{ id: a.id }], { actor: from, actorDisplayName });
      return { id };
    }, {
      description: 'Remove a task — admin only via item-store role policy.',
      visibility:  'authenticated',
    }),

    /**
     * listOpen({type?, requiredSkill?, assignee?, status?})
     * Returns items + computed `status` (ready/waiting/blocked).
     */
    defineSkill('listOpen', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const filter = {};
      if (a.type)          filter.type          = a.type;
      if (a.requiredSkill) filter.requiredSkill = a.requiredSkill;
      if ('assignee' in a) filter.assignee      = a.assignee;
      const open   = await crew.itemStore.listOpen(filter);
      const closed = await crew.itemStore.listClosed();
      // 41.18 follow-up — every item carries:
      //   status   — lifecycle ∪ DAG (effectiveStatus)
      //   openDeps — unmet dependency IDs (unmetDeps); empty array
      //              when all deps satisfied. UI gates Mark-complete
      //              / Approve on `openDeps.length === 0` so a
      //              claimed-but-deps-blocked task pre-disables the
      //              CTA instead of waiting for the substrate's
      //              DependenciesOpenError post-tap (V2.7 hard-deps).
      const items = open.map((t) => ({
        ...t,
        status:   effectiveStatus(t, open, closed),
        openDeps: unmetDeps(t, open, closed),
      }));
      const filtered = a.status ? items.filter((t) => t.status === a.status) : items;
      return { items: filtered };
    }, {
      description: 'List open tasks with computed status; filters: type/requiredSkill/assignee/status.',
      visibility:  'authenticated',
    }),

    /**
     * listMine({})  — open tasks assigned to the calling actor.
     * Includes DAG `status` per item so V2.7's open-deps gate
     * surfaces in the My-work UI (disabled "Mark complete" button).
     */
    defineSkill('listMine', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const open   = await crew.itemStore.listOpen();
      const closed = await crew.itemStore.listClosed();
      const items  = open
        .filter((t) => t.assignee === from)
        .map((t) => ({
          ...t,
          status:   effectiveStatus(t, open, closed),
          openDeps: unmetDeps(t, open, closed),
        }));
      return { items };
    }, {
      description: 'List open tasks assigned to the calling actor.',
      visibility:  'authenticated',
    }),

    /**
     * listClaimable({skill?})  — unassigned tasks (optionally skill-filtered).
     */
    defineSkill('listClaimable', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const filter = { assignee: null };
      if (a.skill) filter.requiredSkill = a.skill;
      const items = await crew.itemStore.listOpen(filter);
      return { items };
    }, {
      description: 'List unassigned tasks; optional `skill` filter.',
      visibility:  'authenticated',
    }),

    // ── DoD-lifecycle skills (Tasks V1, Phase 5) ─────────────────────────

    /**
     * submitTask({id, deliverable?, note?})
     *   claimed → submitted. Assignee submits with optional artifact
     *   reference. Substrate-side gating via `canSubmit`.
     */
    defineSkill('submitTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const updated = await crew.itemStore.submit(a.id, {
        ...(a.deliverable !== undefined ? { deliverable: a.deliverable } : {}),
        ...(a.note        !== undefined ? { note:        a.note        } : {}),
      }, { actor: from, actorDisplayName });
      return { task: updated };
    }, {
      description: 'Submit a claimed task for approval.',
      visibility:  'authenticated',
    }),

    /**
     * approveTask({id, note?})
     *   submitted → complete. Approver designated by item.approval.
     */
    defineSkill('approveTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      try {
        const updated = await crew.itemStore.approve(a.id, {
          ...(a.note !== undefined ? { note: a.note } : {}),
        }, { actor: from, actorDisplayName });
        return { task: updated };
      } catch (err) {
        if (err?.code === 'DEPENDENCIES_OPEN') {
          return { error: 'has-open-dependencies', openDeps: err.openDeps };
        }
        throw err;
      }
    }, {
      description: 'Approve a submitted task.',
      visibility:  'authenticated',
    }),

    /**
     * rejectTask({id, note})
     *   submitted → rejected → claimed. Note is mandatory.
     */
    defineSkill('rejectTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const updated = await crew.itemStore.reject(a.id, { note: a.note }, { actor: from, actorDisplayName });
      return { task: updated };
    }, {
      description: 'Reject a submitted task with a mandatory note.',
      visibility:  'authenticated',
    }),

    /**
     * revokeTask({id, reason})
     *   claimed → open. Master / admin / coordinator only.
     *   Reason is mandatory; assignee gets it in the inbox + can appeal.
     */
    defineSkill('revokeTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const updated = await crew.itemStore.revoke(a.id, { reason: a.reason }, { actor: from, actorDisplayName });
      return { task: updated, previousAssignee: a.previousAssignee };
    }, {
      description: 'Revoke an assignment with a mandatory reason (master only).',
      visibility:  'authenticated',
    }),

    /**
     * setApprovalMode({id, mode})
     *   Mutate the item's approval mode. App-level gating via canEditBody.
     */
    defineSkill('setApprovalMode', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const updated = await crew.itemStore.setApprovalMode(a.id, a.mode, { actor: from, actorDisplayName });
      return { task: updated };
    }, {
      description: 'Change the approval mode of an existing task.',
      visibility:  'authenticated',
    }),
  ];
}

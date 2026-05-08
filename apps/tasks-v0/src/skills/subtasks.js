/**
 * subtasks — Tasks V1 Phase 7.
 *
 * Three skills:
 *
 *   1. `addSubtask({parentTaskId, ...partial})` — claimer-of-parent
 *      OR parent's master OR admin/coord can spawn. Computes the
 *      sub-task's depth via `parentTaskId` walk; if depth >
 *      `crewConfig.subtasksAdminApprovalDepth` (default 3),
 *      INSTEAD of creating the sub-task immediately, files a
 *      `type: 'subtask-request'` item in the same item-store and
 *      returns `{queued: true, requestId}`. Crew admins receive
 *      an inbox notification (wired separately).
 *
 *   2. `approveSubtaskRequest({requestId})` — admin / coordinator
 *      only. Reads the queued request and creates the actual
 *      sub-task using its stored partial. Marks the request
 *      complete (clears it from the queue).
 *
 *   3. `declineSubtaskRequest({requestId, note?})` — admin /
 *      coordinator only. Marks the request complete with a decline
 *      note. The spawner gets an inbox entry via the existing
 *      `wireIssuerNotifications` (item-completed listener).
 *
 * Design notes:
 *
 *   - Master of a spawned sub-task = the spawner (NOT the parent's
 *     master). The parent's master keeps oversight via the dep edge
 *     — they can `revoke` the parent (which cascades a prompt to the
 *     spawner) and they can see the entire sub-task tree, but day-
 *     to-day ownership of grandchildren rests with the spawner.
 *   - Parent's `dependencies` is updated in-place to include the
 *     new sub-task's id (so `computeStatus` correctly reports the
 *     parent as `waiting` until all sub-tasks complete).
 *   - Cycle detection: rejected before write via `wouldCreateParentCycle`.
 */

import { defineSkill } from '@canopy/core';

import { depthOf, wouldCreateParentCycle } from '../dag-tree.js';
import { argsFromParts } from '../bundleResolver.js';

const REQUEST_TYPE = 'subtask-request';
const PROPOSAL_TYPE = 'subtask-proposal';
const DEFAULT_ADMIN_APPROVAL_DEPTH = 3;

/**
 * Build the sub-task skills.
 *
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildSubtaskSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildSubtaskSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('addSubtask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      if (typeof a.parentTaskId !== 'string' || !a.parentTaskId) {
        return { error: 'parentTaskId required' };
      }
      if (typeof a.text !== 'string' || !a.text.trim()) {
        return { error: 'text required' };
      }
      if (typeof from !== 'string' || !from) {
        return { error: 'webid required (from envelope)' };
      }

      const itemStore = crew.itemStore;
      const parent = await itemStore.getById(a.parentTaskId);
      if (!parent) return { error: 'parent task not found', parentTaskId: a.parentTaskId };
      if (parent.completedAt) {
        return { error: 'parent task is already complete' };
      }

      // Authz: caller must be parent's assignee OR master OR admin/coord.
      const role = crew.roles?.[from];
      const isAdminish = role === 'admin' || role === 'coordinator';
      const allowed =
        isAdminish ||
        parent.assignee === from ||
        (parent.master ?? parent.addedBy) === from;
      if (!allowed) {
        return {
          error: 'only the parent\'s assignee, master, or an admin/coordinator may spawn sub-tasks',
        };
      }

      // V2.7 — when parent has an open submission, addSubtask is
      // blocked. Caller must use proposeSubtask, which goes through
      // assignee approval. Self-spawn (assignee adding to their own
      // task) is allowed — the assignee can amend their own scope.
      if (_hasOpenSubmission(parent) && parent.assignee !== from) {
        return {
          error:            'parent-submitted',
          proposalRequired: true,
          parentTaskId:     a.parentTaskId,
          assignee:         parent.assignee,
        };
      }

      // Compute depth via parentTaskId walk.
      // Top-level task = depth 0; direct child = depth 1; etc.
      const allOpen   = await itemStore.listOpen();
      const allClosed = await itemStore.listClosed();
      const allTasks  = [...allOpen, ...allClosed];
      const newDepth  = depthOf(a.parentTaskId, allTasks) + 1;

      const lc = crew.liveCrew ?? {};
      const threshold = Number.isFinite(lc?.subtasksAdminApprovalDepth)
        ? lc.subtasksAdminApprovalDepth
        : DEFAULT_ADMIN_APPROVAL_DEPTH;

      // Build the partial we'll either persist directly or store
      // inside the request blob.
      const partial = {
        type:           a.type ?? 'task',
        text:           a.text,
        parentTaskId:   a.parentTaskId,
        master:         a.master ?? from,    // spawner is master by default
        ...(a.notes            !== undefined ? { notes:            a.notes }            : {}),
        ...(a.requiredSkills   !== undefined ? { requiredSkills:   a.requiredSkills }   : {}),
        ...(a.dueAt            !== undefined ? { dueAt:            a.dueAt }            : {}),
        ...(a.visibility       !== undefined ? { visibility:       a.visibility }       : {}),
        ...(a.definitionOfDone !== undefined ? { definitionOfDone: a.definitionOfDone } : {}),
        ...(a.approval         !== undefined ? { approval:         a.approval }         : {}),
      };

      if (newDepth > threshold) {
        // Queue an admin-approval request.
        const [request] = await itemStore.addItems([{
          type:    REQUEST_TYPE,
          text:    `Sub-task request: "${a.text}" under "${parent.text}"`,
          source: {
            kind:           'subtask-request',
            parentTaskId:   a.parentTaskId,
            requestedBy:    from,
            requestedDepth: newDepth,
            partial,
          },
          master: from,
        }], { actor: from, actorDisplayName });
        return {
          queued:    true,
          requestId: request.id,
          newDepth,
          threshold,
        };
      }

      // Cycle check: would the new edge close a parent-chain cycle?
      // Pure-logic; cheap.
      const cycle = wouldCreateParentCycle(a.parentTaskId, '__new__', allTasks);
      if (cycle) {
        return { error: 'parent-chain cycle detected', cycle };
      }

      // Create the sub-task.
      const [sub] = await itemStore.addItems([partial], { actor: from, actorDisplayName });

      // Wire the parent's `dependencies` to include the child id so
      // `computeStatus` reports the parent as `waiting` until the
      // sub-task completes.
      const parentDeps = Array.isArray(parent.dependencies) ? parent.dependencies : [];
      if (!parentDeps.includes(sub.id)) {
        await itemStore.update(a.parentTaskId, {
          dependencies: [...parentDeps, sub.id],
        }, { actor: from, actorDisplayName });
      }

      return {
        queued: false,
        task:   sub,
        depth:  newDepth,
      };
    }, {
      description: 'Spawn a sub-task. Past the crew\'s admin-approval depth, files a request instead.',
      visibility:  'authenticated',
    }),

    defineSkill('approveSubtaskRequest', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const role = crew.roles?.[from];
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      if (typeof a.requestId !== 'string' || !a.requestId) {
        return { error: 'requestId required' };
      }
      const itemStore = crew.itemStore;
      const req = await itemStore.getById(a.requestId);
      if (!req) return { error: 'request not found', requestId: a.requestId };
      if (req.type !== REQUEST_TYPE) {
        return { error: 'item is not a subtask-request', requestId: a.requestId };
      }
      if (req.completedAt) {
        return { error: 'request already resolved' };
      }
      const partial = req.source?.partial;
      if (!partial || typeof partial !== 'object') {
        return { error: 'request has no partial; cannot create sub-task' };
      }
      const parent = await itemStore.getById(partial.parentTaskId);
      if (!parent) {
        return { error: 'parent task no longer exists; decline this request instead' };
      }

      // Create the sub-task on behalf of the original requester.
      const [sub] = await itemStore.addItems([partial], {
        actor: req.source.requestedBy,
      });

      // Wire the parent's dependencies + close the request.
      const parentDeps = Array.isArray(parent.dependencies) ? parent.dependencies : [];
      if (!parentDeps.includes(sub.id)) {
        await itemStore.update(parent.id, {
          dependencies: [...parentDeps, sub.id],
        }, { actor: from, actorDisplayName });
      }
      await itemStore.markComplete([{ id: req.id }], { actor: from, actorDisplayName });

      return { ok: true, task: sub, requestId: req.id };
    }, {
      description: 'Approve a queued sub-task request (admin/coordinator only).',
      visibility:  'authenticated',
    }),

    defineSkill('declineSubtaskRequest', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const role = crew.roles?.[from];
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      if (typeof a.requestId !== 'string' || !a.requestId) {
        return { error: 'requestId required' };
      }
      const itemStore = crew.itemStore;
      const req = await itemStore.getById(a.requestId);
      if (!req) return { error: 'request not found', requestId: a.requestId };
      if (req.type !== REQUEST_TYPE) {
        return { error: 'item is not a subtask-request', requestId: a.requestId };
      }
      if (req.completedAt) return { error: 'request already resolved' };

      // Update notes (visible in audit log) then mark the request
      // complete. The spawner sees a "task completed" inbox entry
      // via the existing wireIssuerNotifications listener.
      await itemStore.update(req.id, {
        notes: a.note ? `Declined: ${a.note}` : 'Declined',
      }, { actor: from, actorDisplayName });
      await itemStore.markComplete([{ id: req.id }], { actor: from, actorDisplayName });

      return { ok: true, requestId: req.id };
    }, {
      description: 'Decline a queued sub-task request (admin/coordinator only).',
      visibility:  'authenticated',
    }),

    /**
     * V2.7 — propose a sub-task on a `submitted` parent. Files a
     * `subtask-proposal` queue item targeting the parent's assignee.
     * The assignee approves or declines via the two skills below.
     *
     * Authz: master / coord / admin (same set as addSubtask, since
     * this is the after-submit equivalent).
     */
    defineSkill('proposeSubtask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      if (typeof a.parentTaskId !== 'string' || !a.parentTaskId) {
        return { error: 'parentTaskId required' };
      }
      if (typeof a.text !== 'string' || !a.text.trim()) {
        return { error: 'text required' };
      }
      const itemStore = crew.itemStore;
      const parent = await itemStore.getById(a.parentTaskId);
      if (!parent) return { error: 'parent task not found', parentTaskId: a.parentTaskId };
      if (parent.completedAt) return { error: 'parent task is already complete' };
      if (!_hasOpenSubmission(parent)) {
        return { error: 'parent is not in submitted state — use addSubtask directly' };
      }
      if (!parent.assignee) {
        return { error: 'parent has no assignee — propose-flow needs someone to consent' };
      }
      const role = crew.roles?.[from];
      const isAdminish = role === 'admin' || role === 'coordinator';
      const isMaster   = (parent.master ?? parent.addedBy) === from;
      if (!isAdminish && !isMaster) {
        return { error: 'master, coordinator, or admin required for proposeSubtask' };
      }

      const partial = {
        type:           a.type ?? 'task',
        text:           a.text,
        parentTaskId:   a.parentTaskId,
        master:         a.master ?? from,
        ...(a.notes            !== undefined ? { notes:            a.notes }            : {}),
        ...(a.requiredSkills   !== undefined ? { requiredSkills:   a.requiredSkills }   : {}),
        ...(a.dueAt            !== undefined ? { dueAt:            a.dueAt }            : {}),
        ...(a.visibility       !== undefined ? { visibility:       a.visibility }       : {}),
        ...(a.definitionOfDone !== undefined ? { definitionOfDone: a.definitionOfDone } : {}),
        ...(a.approval         !== undefined ? { approval:         a.approval }         : {}),
      };

      const [proposal] = await itemStore.addItems([{
        type:    PROPOSAL_TYPE,
        text:    `Sub-task proposal: "${a.text}" under "${parent.text}"`,
        source: {
          kind:           'subtask-proposal',
          parentTaskId:   a.parentTaskId,
          requestedBy:    from,
          targetAssignee: parent.assignee,
          partial,
        },
        master: from,
      }], { actor: from, actorDisplayName });

      return {
        queued:     true,
        proposalId: proposal.id,
        assignee:   parent.assignee,
      };
    }, {
      description: 'Propose a sub-task on a submitted parent — assignee must consent.',
      visibility:  'authenticated',
    }),

    /**
     * V2.7 — assignee approves the proposal. Spawns the sub-task,
     * walks the parent submitted → claimed via the existing reject
     * primitive (preserves the original `submit` entry in the
     * reviewLog as history).
     */
    defineSkill('approveSubtaskProposal', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      if (typeof a.proposalId !== 'string' || !a.proposalId) {
        return { error: 'proposalId required' };
      }
      const itemStore = crew.itemStore;
      const prop = await itemStore.getById(a.proposalId);
      if (!prop) return { error: 'proposal not found', proposalId: a.proposalId };
      if (prop.type !== PROPOSAL_TYPE) {
        return { error: 'item is not a subtask-proposal', proposalId: a.proposalId };
      }
      if (prop.completedAt) return { error: 'proposal already resolved' };

      const targetAssignee = prop.source?.targetAssignee;
      if (from !== targetAssignee) {
        return { error: 'only the parent\'s assignee can approve this proposal' };
      }

      const partial = prop.source?.partial;
      if (!partial || typeof partial !== 'object') {
        return { error: 'proposal has no stored partial — cannot spawn' };
      }
      const parentId = partial.parentTaskId;
      const parent = await itemStore.getById(parentId);
      if (!parent) {
        return { error: 'parent task no longer exists; decline this proposal instead' };
      }

      // Spawn the sub-task on behalf of the original proposer.
      const [sub] = await itemStore.addItems(
        [partial],
        { actor: prop.source.requestedBy, actorDisplayName },
      );

      // Wire parent.dependencies to include the new child id.
      const parentDeps = Array.isArray(parent.dependencies) ? parent.dependencies : [];
      if (!parentDeps.includes(sub.id)) {
        await itemStore.update(parent.id, {
          dependencies: [...parentDeps, sub.id],
        }, { actor: from, actorDisplayName });
      }

      // Walk parent submitted → claimed via the reject primitive.
      try {
        await itemStore.reject(parent.id, {
          note: `auto-rollback: scope changed via subtask proposal ${prop.id}`,
        }, { actor: prop.source.requestedBy, actorDisplayName: `${from} (assignee approved)` });
      } catch {
        // If the parent isn't actually in submitted state any more
        // (race), continue — the new sub-task still got created.
      }

      // Mark the proposal complete.
      await itemStore.markComplete([{ id: prop.id }], { actor: from, actorDisplayName });

      return { ok: true, task: sub, proposalId: prop.id, parentRolledBack: true };
    }, {
      description: 'Assignee approves a subtask-proposal; spawns subtask + rolls parent submitted→claimed.',
      visibility:  'authenticated',
    }),

    defineSkill('declineSubtaskProposal', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      if (typeof a.proposalId !== 'string' || !a.proposalId) {
        return { error: 'proposalId required' };
      }
      const itemStore = crew.itemStore;
      const prop = await itemStore.getById(a.proposalId);
      if (!prop) return { error: 'proposal not found', proposalId: a.proposalId };
      if (prop.type !== PROPOSAL_TYPE) {
        return { error: 'item is not a subtask-proposal', proposalId: a.proposalId };
      }
      if (prop.completedAt) return { error: 'proposal already resolved' };
      const targetAssignee = prop.source?.targetAssignee;
      if (from !== targetAssignee) {
        return { error: 'only the parent\'s assignee can decline this proposal' };
      }

      await itemStore.update(prop.id, {
        notes: a.note ? `Declined: ${a.note}` : 'Declined',
      }, { actor: from, actorDisplayName });
      await itemStore.markComplete([{ id: prop.id }], { actor: from, actorDisplayName });

      return { ok: true, proposalId: prop.id };
    }, {
      description: 'Assignee declines a subtask-proposal; parent submission stays valid.',
      visibility:  'authenticated',
    }),

    /**
     * V2.7 — admin override: bypass both the post-submit gate AND
     * the admin-approval-depth threshold. Mandatory `reason` lands
     * in the audit log under a distinct `force-spawn` action label
     * so the override is auditable.
     */
    defineSkill('forceSpawnSubtask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const role = crew.roles?.[from];
      if (role !== 'admin') return { error: 'admin required' };
      const a = argsFromParts(parts);
      if (typeof a.parentTaskId !== 'string' || !a.parentTaskId) {
        return { error: 'parentTaskId required' };
      }
      if (typeof a.text !== 'string' || !a.text.trim()) {
        return { error: 'text required' };
      }
      if (typeof a.reason !== 'string' || !a.reason.trim()) {
        return { error: 'reason required (mandatory; recorded in the audit log)' };
      }
      const itemStore = crew.itemStore;
      const parent = await itemStore.getById(a.parentTaskId);
      if (!parent) return { error: 'parent task not found', parentTaskId: a.parentTaskId };
      if (parent.completedAt) return { error: 'parent task is already complete' };

      const partial = {
        type:           a.type ?? 'task',
        text:           a.text,
        parentTaskId:   a.parentTaskId,
        master:         a.master ?? from,
        ...(a.notes            !== undefined ? { notes:            a.notes }            : {}),
        ...(a.requiredSkills   !== undefined ? { requiredSkills:   a.requiredSkills }   : {}),
        ...(a.dueAt            !== undefined ? { dueAt:            a.dueAt }            : {}),
        ...(a.visibility       !== undefined ? { visibility:       a.visibility }       : {}),
        ...(a.definitionOfDone !== undefined ? { definitionOfDone: a.definitionOfDone } : {}),
        ...(a.approval         !== undefined ? { approval:         a.approval }         : {}),
      };

      const [sub] = await itemStore.addItems([partial], {
        actor:            from,
        actorDisplayName,
        actionOverride:   'force-spawn',
        reason:           a.reason.trim(),
      });

      const parentDeps = Array.isArray(parent.dependencies) ? parent.dependencies : [];
      if (!parentDeps.includes(sub.id)) {
        await itemStore.update(parent.id, {
          dependencies: [...parentDeps, sub.id],
        }, { actor: from, actorDisplayName });
      }

      return { ok: true, task: sub, reason: a.reason.trim() };
    }, {
      description: 'Admin-only force-spawn override (bypasses post-submit gate + approval-depth; mandatory reason).',
      visibility:  'authenticated',
    }),
  ];
}

/**
 * V2.7 — true iff the task's reviewLog has a `submit` entry without
 * a subsequent `approve` or `reject`. I.e. parent is currently in
 * the "submitted" state.
 */
function _hasOpenSubmission(task) {
  const log = Array.isArray(task?.reviewLog) ? task.reviewLog : [];
  let lastSubmit = -1;
  let lastVerdict = -1;
  for (let i = 0; i < log.length; i++) {
    const d = log[i]?.decision;
    if (d === 'submit') lastSubmit = i;
    if (d === 'approve' || d === 'reject') lastVerdict = i;
  }
  return lastSubmit > lastVerdict;
}

export { REQUEST_TYPE, DEFAULT_ADMIN_APPROVAL_DEPTH, PROPOSAL_TYPE };

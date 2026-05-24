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
import { saveCrewConfig, loadCrewConfig, KIND_DEFAULTS } from '../Crew.js';
import {
  startPodSignIn      as _startPodSignIn,
  completePodSignIn   as _completePodSignIn,
  signOutOfPod        as _signOutOfPod,
  podSignInStatus     as _podSignInStatus,
} from '../lib/podSignIn.js';

/**
 * Cross-pod ref soft cap on `addTask({embeds: [...]})`. Eight keeps
 * the task panel readable while still allowing "this task touches
 * several other items" use cases. Tasks V2 substrate-adoption (the
 * A4 equivalent from Stoop V2 web). V2 functional design §4b.
 */
const MAX_EMBEDS_PER_TASK = 8;

function _validateEmbed(e) {
  if (!e || typeof e !== 'object') return 'embed-not-object';
  if (typeof e.type !== 'string' || e.type.length === 0) return 'embed-type-missing';
  if (typeof e.ref  !== 'string' || e.ref.length  === 0) return 'embed-ref-missing';
  return null;
}

/**
 * Tasks V2 (2026-05-14) — crew storage policies (§II.2 of the
 * standardisation plan). Mirror of Stoop's A3 picker.
 */
const CREW_STORAGE_POLICIES = ['no-pod', 'centralised', 'decentralised', 'hybrid'];

function _validateStoragePolicy(storagePolicy, groupPodUri) {
  if (typeof storagePolicy === 'undefined' || storagePolicy === null) return null;
  if (typeof storagePolicy !== 'string') return 'storage-policy-not-string';
  if (!CREW_STORAGE_POLICIES.includes(storagePolicy)) return `storage-policy-unknown:${storagePolicy}`;
  if (storagePolicy === 'centralised' || storagePolicy === 'hybrid') {
    if (typeof groupPodUri !== 'string' || groupPodUri.length === 0) {
      return `storage-policy-needs-groupPodUri:${storagePolicy}`;
    }
  }
  return null;
}

function _buildStoragePolicy(storagePolicy, groupPodUri) {
  const policy = (typeof storagePolicy === 'string' && CREW_STORAGE_POLICIES.includes(storagePolicy))
    ? storagePolicy
    : 'no-pod';
  if (policy === 'centralised' || policy === 'hybrid') {
    return { policy, groupPodUri };
  }
  return { policy };
}

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 * @param {() => Iterable<object>} [args.crewsProvider]
 *   Optional. Used by **platform-level** skills (`provisionMyCrew`,
 *   `listSavedCrewConfigs`, `spawnMyCrew`) as a fallback when the
 *   regular routing-via-args.crewId resolution misses. Those skills
 *   write/read shared local-store state and don't care which crew
 *   they're "associated" with, so they pick the first available crew
 *   instead of returning a crewId-required error. Crew-strict skills
 *   (addTask, claimTask, etc.) still strict-null on miss.
 * @returns {Array<object>} array of `defineSkill` definitions
 */
export function buildSkills({ bundleResolver, crewsProvider } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildSkills: bundleResolver(parts, ctx) required');
  }

  /**
   * Resolve a crew for a platform-level skill — try the strict
   * routing first, fall back to the first crew in `crewsProvider()`
   * when the lookup misses. Single-crew launches get the same
   * behaviour as before (`bundleResolver` returns the single crew
   * regardless of `args.crewId`).
   */
  function resolveAnyCrew(parts, ctx) {
    const direct = bundleResolver(parts, ctx);
    if (direct) return direct;
    if (typeof crewsProvider === 'function') {
      const iter = crewsProvider();
      if (iter && typeof iter[Symbol.iterator] === 'function') {
        const first = iter[Symbol.iterator]().next();
        if (!first.done && first.value) return first.value;
      }
    }
    return null;
  }

  return [
    /**
     * addTask({type='task', text, notes?, dependencies?, requiredSkills?,
     *         dueAt?, visibility?, embeds?})
     * Validates DAG cycle-free.  Returns the persisted task.
     *
     * Tasks V2 substrate-adoption (2026-05-14) — accepts `embeds: [{type,
     * ref}, ...]` for cross-pod refs (V2 web functional design §4b).
     * Each entry references another item (a Folio note, a Stoop post,
     * another task). Validated minimally; cap of 8. The receiving side
     * (substrate-mirror, once Tasks adopts one) carries the shape
     * through via the base canonical schema's `embeds` field.
     */
    defineSkill('addTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      // Phase 10 — block addTask when the crew is paused or archived.
      const lc = crew.liveCrew;
      if (lc?.archived) return { error: 'crew-archived' };
      if (lc?.paused)   return { error: 'crew-paused' };

      const a = argsFromParts(parts);

      // Validate optional embeds (cross-pod refs).
      const inboundEmbeds = Array.isArray(a.embeds) ? a.embeds : [];
      if (inboundEmbeds.length > MAX_EMBEDS_PER_TASK) {
        return { error: `embeds-too-many:${inboundEmbeds.length}` };
      }
      const embeds = [];
      for (const e of inboundEmbeds) {
        const err = _validateEmbed(e);
        if (err) return { error: err };
        embeds.push({ type: e.type, ref: e.ref });
      }

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
        // Tasks V2 standardisation adoption — cross-pod refs.
        ...(embeds.length > 0  ? { embeds } : {}),
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

      // Phase 52.9.3 (Tasks V2 ninth slice, 2026-05-14) — substrate
      // fan-out. The mirror's publishTask helper handles the URI +
      // pseudoPod.write + notifyEnvelope.publish + recipient roster
      // all together; here we just kick it off.
      crew?.tasksMirror?.publishTask?.(task).catch(() => {});

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
      // Phase 52.9.3 sub-slice 1 — publish the post-claim state. The
      // substrate is the source of authorisation truth on the
      // receiver side via applySync (gate-bypass); the receiver's
      // local item-store doesn't re-check the claim policy.
      if (result && !result.error) {
        crew?.tasksMirror?.publishTask?.(result).catch(() => {});
      }
      return { result };
    }, {
      description: 'Compare-and-swap claim a task.',
      visibility:  'authenticated',
    }),

    /**
     * editTask({id, text?, notes?, dueAt?, requiredSkills?,
     *           dependencies?, scheduledAt?, estimateMinutes?,
     *           definitionOfDone?, visibility?})
     *   — 2026-05-24.  Patch body fields on an existing task.
     *
     *   Wraps itemStore.update which forbids editing attribution /
     *   completion / assignment fields (those have dedicated
     *   primitives — claim, submit, approve, …).  Caller can
     *   change any combination of the allowed fields in one call.
     *
     *   Re-validates the DAG when dependencies change so an edit
     *   can't introduce a cycle.  Blocked when the crew is paused
     *   or archived (same gate as addTask).
     */
    defineSkill('editTask', async ({ parts, from, envelope, actorDisplayName }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const lc = crew.liveCrew;
      if (lc?.archived) return { error: 'crew-archived' };
      if (lc?.paused)   return { error: 'crew-paused' };

      const a = argsFromParts(parts);
      if (typeof a.id !== 'string' || !a.id) return { error: 'id required' };

      // Only forward fields the caller actually supplied — undefined
      // would clobber existing values.
      const patch = {};
      for (const f of [
        'text', 'notes', 'dueAt', 'requiredSkills', 'dependencies',
        'scheduledAt', 'estimateMinutes', 'definitionOfDone', 'visibility',
      ]) {
        if (a[f] !== undefined) patch[f] = a[f];
      }
      if (Object.keys(patch).length === 0) return { error: 'no fields to update' };

      // DAG cycle re-check when dependencies change.
      if (Array.isArray(patch.dependencies) && patch.dependencies.length > 0) {
        const all = await crew.itemStore.listOpen();
        const cycle = detectCycle({ id: a.id, dependencies: patch.dependencies }, all);
        if (cycle) {
          throw Object.assign(
            new Error(`editTask: dependency cycle would form: ${cycle.join(' → ')}`),
            { code: 'DEPENDENCY_CYCLE', cycle },
          );
        }
      }

      try {
        const updated = await crew.itemStore.update(a.id, patch, { actor: from, actorDisplayName });
        // Re-publish through the substrate mirror so other crew
        // members see the update (same fan-out as addTask).
        crew?.tasksMirror?.publishTask?.(updated).catch(() => {});
        return { task: updated };
      } catch (err) {
        if (err?.code === 'ITEM_NOT_FOUND') return { error: 'not-found' };
        if (err?.code === 'PERMISSION_DENIED') return { error: 'permission-denied' };
        throw err;
      }
    }, {
      description: 'Patch body fields on an existing task (text, notes, dueAt, …); paused/archived crews blocked.',
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
        // Phase 52.9.3 sub-slice 1 — fan-out the completion.
        if (completed) {
          crew?.tasksMirror?.publishTask?.(completed).catch(() => {});
        }
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
      // Phase 52.9.3 sub-slice 1 — fan-out the reassignment.
      if (updated) crew?.tasksMirror?.publishTask?.(updated).catch(() => {});
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
      // Capture the item's syncedFromId BEFORE removal (the
      // receiver-side mirror matches by the publishing device's id,
      // which may differ from `a.id` if THIS device is itself a
      // synced replica). We send the syncedFromId when present;
      // otherwise our local id is the canonical one.
      const localItem = (await crew.itemStore.listOpen()).find((i) => i.id === a.id)
                     ?? (await crew.itemStore.listClosed()).find((i) => i.id === a.id);
      const originalId = localItem?.source?.syncedFromId ?? a.id;
      const [id] = await crew.itemStore.removeItems([{ id: a.id }], { actor: from, actorDisplayName });
      // Phase 52.9.3 sub-slice 1 — fan-out the removal.
      crew?.tasksMirror?.publishTaskRemoved?.(originalId).catch(() => {});
      return { id };
    }, {
      description: 'Remove a task — admin only via item-store role policy.',
      visibility:  'authenticated',
    }),

    /**
     * listOpen({type?, requiredSkill?, assignee?, status?})
     * Returns items + computed `status` (ready/waiting/blocked).
     */
    /**
     * `getTaskSnapshot(id)` → ItemSnapshot — Q29 (canopy-chat v0.5)
     * snapshot factory.  Returns a thin display projection of the
     * task suitable for embedding in a chat message.  Read-only;
     * idempotent.  When canopy-chat consumes tasks-v0's full
     * manifest, /embed against a task surfaces a real card with
     * lifecycle-state-gated action buttons.
     */
    defineSkill('getTaskSnapshot', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      if (!a.id) return { error: 'id required' };
      const open   = await crew.itemStore.listOpen({});
      const closed = await crew.itemStore.listClosed();
      const all    = [...open, ...closed];
      const target = all.find((t) => t.id === a.id);
      if (!target) return { error: `task "${a.id}" not found` };
      const status = effectiveStatus(target, open, closed);
      return {
        id:    target.id,
        type:  target.type ?? 'task',
        state: status,
        title: target.text ?? target.id,
        fields: {
          state:    status,
          assignee: target.assignee ?? 'unassigned',
          ...(target.requiredSkill ? { requires: target.requiredSkill } : {}),
        },
      };
    }, {
      description: 'Snapshot a task for chat-embed (Q29 v0.5).',
      visibility:  'authenticated',
    }),

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
      // Phase 52.9.3 sub-slice 1 — fan-out the submission.
      if (updated) crew?.tasksMirror?.publishTask?.(updated).catch(() => {});
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
        // Phase 52.9.3 sub-slice 1 — fan-out the approval.
        if (updated) crew?.tasksMirror?.publishTask?.(updated).catch(() => {});
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
      // Phase 52.9.3 sub-slice 1 — fan-out the rejection.
      if (updated) crew?.tasksMirror?.publishTask?.(updated).catch(() => {});
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
      // Phase 52.9.3 sub-slice 1 — fan-out the revocation.
      if (updated) crew?.tasksMirror?.publishTask?.(updated).catch(() => {});
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

    /**
     * getCrewStoragePolicy({crewId})
     *   — Tasks V2 standardisation adoption (2026-05-14). Returns the
     *   crew's storage policy `{policy, groupPodUri?}` from its
     *   `crewConfig.storage`. Defaults to `'no-pod'`.
     */
    defineSkill('getCrewStoragePolicy', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const storage = crew.liveCrew?.storage ?? { policy: 'no-pod' };
      return {
        policy:      storage.policy ?? 'no-pod',
        groupPodUri: storage.groupPodUri ?? null,
      };
    }, {
      description: "Tasks V2: read the crew's storage policy (§II.2: no-pod / centralised / decentralised / hybrid).",
      visibility:  'authenticated',
    }),

    /**
     * setCrewStoragePolicy({crewId, storagePolicy, groupPodUri?})
     *   — Tasks V2 standardisation adoption (2026-05-14). Admin /
     *   coordinator only. **One-way**: rejects downgrade to
     *   `'no-pod'` once a pod-having policy is active (substrate-
     *   side data migration is the user's job, per
     *   `Substrates/storage-migration-design-2026-05-14.md`).
     */
    defineSkill('setCrewStoragePolicy', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      // Admin / coordinator gate via the crew's role map.
      const role = crew.liveCrew?.members?.find?.((m) => m.webid === from)?.role
        ?? crew?.roles?.[from] ?? null;
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin-only' };
      }
      const err = _validateStoragePolicy(a.storagePolicy, a.groupPodUri);
      if (err) return { error: err };
      const next = _buildStoragePolicy(a.storagePolicy, a.groupPodUri);
      const current = crew.liveCrew?.storage ?? { policy: 'no-pod' };
      if (current.policy && current.policy !== 'no-pod' && next.policy === 'no-pod') {
        return { error: 'storage-policy-downgrade-not-supported' };
      }
      // Apply via the frozen-copy mutator (crewState.crewMutator).
      if (typeof crew.crewMutator === 'function') {
        crew.crewMutator({ storage: next });
      }
      return { crewId: crew.liveCrew?.crewId ?? a.crewId ?? null, storage: next };
    }, {
      description: 'Tasks V2: admin-only upgrade of the crew storage policy. One-way.',
      visibility:  'authenticated',
    }),

    /**
     * startPodSignIn({issuer, redirectUrl, crewId?})
     *   — Tasks V2 substrate-adoption (2026-05-14, Phase 52.15.3
     *   mirror). Kicks off the OIDC redirect dance. Returns the IdP
     *   authorize URL; the browser navigates there. The session is
     *   stored on `crew.oidcSession` until the callback lands.
     */
    defineSkill('startPodSignIn', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      return _startPodSignIn({ crew, issuer: a.issuer, redirectUrl: a.redirectUrl });
    }, {
      description: 'Phase 1 of pod sign-in: returns the IdP authorize URL.',
      visibility:  'authenticated',
    }),

    /**
     * completePodSignIn({callbackUrl, crewId?})
     *   — Tasks V2 substrate-adoption. Phase 2: handles the OIDC
     *   callback + attaches a SolidPodSource to the crew's
     *   CachingDataSource.
     */
    defineSkill('completePodSignIn', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      return _completePodSignIn({ crew, callbackUrl: a.callbackUrl });
    }, {
      description: 'Phase 2 of pod sign-in: completes the OIDC dance + attaches the pod-backed DataSource.',
      visibility:  'authenticated',
    }),

    /**
     * signOutOfPod({crewId?})
     *   — Tasks V2 substrate-adoption. Detaches the inner DataSource
     *   + clears the OIDC session. Local cache preserved.
     */
    defineSkill('signOutOfPod', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      return _signOutOfPod({ crew });
    }, {
      description: 'Sign out of the active pod; preserves local cache.',
      visibility:  'authenticated',
    }),

    /**
     * podSignInStatus({crewId?})
     *   — Tasks V2 substrate-adoption. Read-only `{signedIn, webid,
     *   podAttached}`.
     */
    defineSkill('podSignInStatus', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      return _podSignInStatus({ crew });
    }, {
      description: 'Read the current pod-sign-in state for this crew.',
      visibility:  'authenticated',
    }),

    /**
     * spawnMyCrew({crewId})
     *
     * Tasks V2 substrate-adoption (2026-05-14, sixth slice). Loads a
     * saved CrewConfig from the local store + (when the CLI is wired
     * for multi-crew runtime) brings up a fresh crew bundle on the
     * shared meshAgent + adds it to the runtime crewsMap.
     *
     * **In-process spawning** requires the host CLI to expose a
     * `_spawnCrewInProcess(crewId)` callback on the resolved crew's
     * `_crewState`. The `bin/tasks-ui.js` `--multi-crew` path wires
     * this; the default single-crew path does NOT.
     *
     * When the callback is missing (single-crew mode), the skill
     * returns a structured `{ok: true, ready: false, restartHint}`
     * payload so the UI can show the user the right CLI command to
     * restart with the new crew bound at boot.
     */
    defineSkill('spawnMyCrew', async ({ parts, from, envelope }) => {
      const crew = resolveAnyCrew(parts, { envelope, from });
      if (!crew?.dataSource?.read) return { error: 'no-data-source' };
      const a = argsFromParts(parts);
      if (typeof a.crewId !== 'string' || !a.crewId) {
        return { error: 'crewId required' };
      }
      if (a.crewId === crew?.liveCrew?.crewId) {
        return { error: 'crew-already-active' };
      }
      // Load the saved config to confirm it exists + is well-formed.
      // `loadCrewConfig` has a fallback for missing entries — we want a
      // strict "exists?" check here so the UI can surface "no such crew".
      const path = `mem://tasks/crews/${a.crewId}/config.json`;
      let cfg;
      try {
        const raw = await crew.dataSource.read(path);
        if (!raw) return { error: 'crew-not-found' };
        cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (err) {
        return { error: `load-failed:${err?.message ?? err}` };
      }
      if (!cfg || cfg.crewId !== a.crewId) {
        return { error: 'crew-not-found' };
      }

      // In-process spawn path (multi-crew runtime).
      if (typeof crew._spawnCrewInProcess === 'function') {
        try {
          const spawned = await crew._spawnCrewInProcess(a.crewId);
          return {
            ok:     true,
            ready:  true,
            crewId: spawned?.liveCrew?.crewId ?? a.crewId,
            name:   spawned?.liveCrew?.name ?? cfg.name,
            kind:   spawned?.liveCrew?.kind ?? cfg.kind,
          };
        } catch (err) {
          return { error: `spawn-failed:${err?.message ?? err}` };
        }
      }

      // Single-crew runtime: structured restart hint.
      return {
        ok:           true,
        ready:        false,
        crewId:       cfg.crewId,
        name:         cfg.name,
        kind:         cfg.kind,
        restartHint:  `Restart the tasks UI bound to "${cfg.crewId}". The single-crew CLI takes \`--crew=<path-to-config.json>\`; the saved config lives at \`mem://tasks/crews/${cfg.crewId}/config.json\` in the local-store. Multi-crew in-process runtime is a follow-up (see Project Files/Tasks App/v2-web-functional-design-2026-05-11.md §6a).`,
      };
    }, {
      description: 'Tasks V2: spawn a saved crew on the running agent (multi-crew runtime) OR return a restart hint when the CLI is single-crew mode.',
      visibility:  'authenticated',
    }),

    /**
     * listSavedCrewConfigs()
     *   — Tasks V2 substrate-adoption (2026-05-14). Scans the local
     *   store for `mem://tasks/crews/<crewId>/config.json` entries and
     *   returns the saved CrewConfigs. Includes a `running` flag per
     *   entry: `true` iff the active bundle is bound to that crewId.
     *   Used by `/crews.html` to surface saved-but-not-running crews
     *   so users can see what `provisionMyCrew` persisted before
     *   multi-crew runtime lands.
     */
    defineSkill('listSavedCrewConfigs', async ({ parts, from, envelope }) => {
      const crew = resolveAnyCrew(parts, { envelope, from });
      if (!crew?.dataSource?.list) return { error: 'no-data-source' };
      let paths;
      try {
        paths = await crew.dataSource.list('mem://tasks/crews/');
      } catch (err) {
        return { error: `list-failed:${err?.message ?? err}` };
      }
      const configs = [];
      const runningId = crew?.liveCrew?.crewId ?? null;
      for (const path of paths ?? []) {
        if (!path.endsWith('/config.json')) continue;
        try {
          const raw = await crew.dataSource.read(path);
          if (!raw) continue;
          const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (!cfg?.crewId) continue;
          configs.push({
            crewId:  cfg.crewId,
            name:    cfg.name ?? cfg.crewId,
            kind:    cfg.kind ?? 'household',
            storage: cfg.storage ?? { policy: 'no-pod' },
            members: Array.isArray(cfg.members)
              ? cfg.members.map(m => ({ webid: m.webid, displayName: m.displayName ?? null, role: m.role ?? 'member' }))
              : [],
            running: cfg.crewId === runningId,
          });
        } catch { /* skip malformed config */ }
      }
      configs.sort((a, b) => a.crewId.localeCompare(b.crewId));
      return { configs };
    }, {
      description: 'Tasks V2: list saved CrewConfigs in the local store with a running-flag per entry.',
      visibility:  'authenticated',
    }),

    /**
     * provisionMyCrew({crewId, name, kind, storagePolicy?, groupPodUri?,
     *                  displayName?, additionalMembers?})
     *
     * Tasks V2 standardisation adoption (2026-05-14). Persists a fresh
     * `CrewConfig` into the local-store at
     * `mem://tasks/crews/<crewId>/config.json` with the caller as
     * admin. Used by `/welcome.html`'s wizard for first-run
     * crew provisioning. The caller still needs to restart Tasks with
     * `--crew=...` (or supply the new crewId at boot) for the runtime
     * to actually bind to the new crew — this skill is the V2 design's
     * §4a "creator picks one of the four §II.2 policies" step, not the
     * full bundle bring-up.
     */
    defineSkill('provisionMyCrew', async ({ parts, from, envelope }) => {
      const crew = resolveAnyCrew(parts, { envelope, from });
      if (!crew?.dataSource?.write) return { error: 'no-data-source' };

      const a = argsFromParts(parts);
      if (typeof a.crewId !== 'string' || !/^[a-z0-9](?:[a-z0-9_-]{1,30}[a-z0-9])?$/.test(a.crewId)) {
        return { error: 'crewId-invalid' };
      }
      if (typeof a.name !== 'string' || a.name.length === 0) {
        return { error: 'name-required' };
      }
      const kind = (typeof a.kind === 'string' && KIND_DEFAULTS[a.kind]) ? a.kind : 'household';

      const storageErr = _validateStoragePolicy(a.storagePolicy, a.groupPodUri);
      if (storageErr) return { error: storageErr };
      const storage = _buildStoragePolicy(a.storagePolicy, a.groupPodUri);

      // Don't overwrite an existing crew with the same id (the wizard
      // surfaces a clear error to the user).
      const path = `mem://tasks/crews/${a.crewId}/config.json`;
      try {
        const existing = await crew.dataSource.read(path);
        if (existing) return { error: 'crewId-already-exists' };
      } catch { /* read-miss is the happy path */ }

      // Build the member list. Caller becomes admin; optional
      // `additionalMembers` lets the wizard seed admins + members.
      const seenWebids = new Set([from]);
      const members = [{
        webid:       from,
        displayName: typeof a.displayName === 'string' && a.displayName.length > 0
          ? a.displayName
          : null,
        role:        'admin',
      }];
      if (Array.isArray(a.additionalMembers)) {
        for (const m of a.additionalMembers) {
          if (!m || typeof m.webid !== 'string' || m.webid.length === 0) continue;
          if (seenWebids.has(m.webid)) continue;
          seenWebids.add(m.webid);
          members.push({
            webid:       m.webid,
            displayName: typeof m.displayName === 'string' ? m.displayName : null,
            role:        m.role === 'admin' || m.role === 'coordinator' || m.role === 'observer'
              ? m.role
              : 'member',
          });
        }
      }

      const saved = await saveCrewConfig({
        dataSource: crew.dataSource,
        config:     { crewId: a.crewId, name: a.name, kind, members, storage },
      });

      return {
        crewId:  saved.crewId,
        name:    saved.name,
        kind:    saved.kind,
        storage: saved.storage,
        members: saved.members,
      };
    }, {
      description: 'Tasks V2: provision a fresh crew config (caller becomes admin).',
      visibility:  'authenticated',
    }),
  ];
}

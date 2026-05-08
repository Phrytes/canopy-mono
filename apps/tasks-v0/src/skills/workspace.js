/**
 * workspace skills — Tasks V1 Phase 8 UI helpers.
 *
 * Skills the workspace UI calls to compose its screens:
 *
 *   - `getCrewConfig()` — read-only snapshot of the live CrewConfig.
 *     The UI uses this for: members chips on /crew, role display,
 *     subtasksAdminApprovalDepth in /add, etc.
 *
 *   - `listAwaitingApproval()` — items in the `submitted` lifecycle
 *     state (have a `reviewLog` whose tail is `submit`). Powers the
 *     /review page.
 *
 *   - `listSubtaskRequests()` — items of type `subtask-request` that
 *     are not yet completed. Admin/coord only. Powers the admin
 *     queue surface inside /crew.
 *
 *   - `getDagTree({rootId})` — returns the `treeOf` projection
 *     starting at `rootId` (or, when `rootId` omitted, every
 *     top-level task expanded). Powers /dag.
 *
 *   - `listMyMasteredTasks()` — open tasks whose `master === from`.
 *     Powers the "I'm master of" tab on /mine.
 *
 * All skills are read-only; no role-policy gating beyond the
 * obvious (subtask requests are admin-visible).
 */

import { defineSkill } from '@canopy/core';

import { computeStatus as itemStoreComputeStatus } from '@canopy/item-store';
import { treeOf } from '../dag-tree.js';
import { computeStatus as dagStatus } from '../dag.js';
import { argsFromParts } from '../bundleResolver.js';

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildWorkspaceSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildWorkspaceSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('getCrewConfig', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const lc = crew.liveCrew;
      return { crew: lc ? { ...lc } : null };
    }, {
      description: 'Read the live CrewConfig (read-only snapshot).',
    }),

    defineSkill('listAwaitingApproval', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const open = await crew.itemStore.listOpen();
      const closed = await crew.itemStore.listClosed();
      const pending = open
        .filter((it) => itemStoreComputeStatus(it) === 'submitted')
        // V2.7 — include DAG `status` so the Review UI can disable the
        // Approve button + show open-deps tooltip when the parent
        // can't actually be closed yet.
        .map((it) => ({ ...it, status: dagStatus(it, open, closed) }));
      return { items: pending, viewer: from ?? null };
    }, {
      description: 'List items in the submitted state (awaiting approval).',
    }),

    defineSkill('listSubtaskRequests', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const role = crew.roles?.[from];
      if (role !== 'admin' && role !== 'coordinator') {
        return { error: 'admin or coordinator required' };
      }
      const open = await crew.itemStore.listOpen({ type: 'subtask-request' });
      return { items: open };
    }, {
      description: 'List pending subtask-request items (admin/coord only).',
    }),

    defineSkill('getDagTree', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      const a = argsFromParts(parts);
      const open   = await crew.itemStore.listOpen();
      const closed = await crew.itemStore.listClosed();
      const all = [...open, ...closed];

      if (typeof a.rootId === 'string' && a.rootId) {
        const tree = treeOf(a.rootId, all);
        return { tree };
      }

      // No rootId → return one tree per top-level task (no parentTaskId).
      const tops = all.filter((t) => !t.parentTaskId && t.type !== 'subtask-request');
      const trees = tops.map((t) => treeOf(t.id, all)).filter(Boolean);
      return { trees };
    }, {
      description: 'Return the sub-task tree rooted at rootId, or every top-level tree.',
    }),

    defineSkill('listMyMasteredTasks', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      if (!from) return { items: [] };
      const open = await crew.itemStore.listOpen();
      const closed = await crew.itemStore.listClosed();
      const mastered = open
        .filter((it) => (it.master ?? it.addedBy) === from)
        .map((it) => ({ ...it, status: dagStatus(it, open, closed) }));
      return { items: mastered };
    }, {
      description: 'Open tasks where the caller is the master.',
    }),
  ];
}

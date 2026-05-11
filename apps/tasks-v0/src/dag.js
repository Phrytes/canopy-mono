/**
 * DAG resolver — H4-specific app-glue.
 *
 * Given a task and the current open + closed sets, compute its
 * `status`: 'ready' (no open deps), 'waiting' (some deps open),
 * 'blocked' (some deps cancelled / removed).
 *
 * Pure function; no substrate dependency.
 */

/**
 * @param {object} task                 the task to compute status for
 * @param {object[]} openItems          all currently open tasks (by id)
 * @param {object[]} closedItems        all currently closed tasks (by id)
 * @returns {'ready'|'waiting'|'blocked'}
 */
export function computeStatus(task, openItems, closedItems) {
  if (!task?.dependencies || task.dependencies.length === 0) return 'ready';
  const openIds   = new Set(openItems.map((t) => t.id));
  const closedIds = new Set(closedItems.map((t) => t.id));
  let waiting = false;
  for (const depId of task.dependencies) {
    if (closedIds.has(depId)) continue;            // dependency satisfied
    if (openIds.has(depId)) { waiting = true; continue; }
    // Dependency neither open nor closed — likely removed/never-existed.
    return 'blocked';
  }
  return waiting ? 'waiting' : 'ready';
}

/**
 * Effective status — lifecycle (assignee / reviewLog / completedAt)
 * union DAG state. Mirrors `effectiveStatus(item)` in the web app
 * (`apps/tasks-v0/web/app.js`); lifted here so the listOpen skill
 * can return a single useful status field that mobile + web both
 * consume verbatim.
 *
 * Order of precedence:
 *   1. completedAt   → 'complete'
 *   2. reviewLog last entry == submit → 'submitted'
 *   3. reviewLog last entry == reject → 'rejected'
 *   4. assignee set  → 'claimed'
 *   5. fallback to DAG status (ready / waiting / blocked)
 *
 * Note: lifecycle status WINS over DAG. A claimed-but-deps-blocked
 * task returns 'claimed', not 'waiting'. To gate UI affordances on
 * the deps-state separately, use `unmetDeps(task, open, closed)` or
 * read the `openDeps[]` field the listOpen skill enriches each
 * item with (mirrors V2.7's `DependenciesOpenError.openDeps`).
 *
 * @param {object} task
 * @param {object[]} openItems
 * @param {object[]} closedItems
 * @returns {'ready'|'waiting'|'blocked'|'claimed'|'submitted'|'rejected'|'complete'}
 */
export function effectiveStatus(task, openItems, closedItems) {
  if (!task) return 'ready';
  if (task.completedAt) return 'complete';
  const log = Array.isArray(task.reviewLog) ? task.reviewLog : [];
  const last = log[log.length - 1]?.decision ?? null;
  if (last === 'submit') return 'submitted';
  if (last === 'reject') return 'rejected';
  if (task.assignee) return 'claimed';
  return computeStatus(task, openItems, closedItems);
}

/**
 * Unmet dependencies — the list of dep IDs that are still open
 * (i.e. not in `closedItems`). Used by the listOpen skill to
 * enrich every item with `openDeps[]` so the UI can pre-disable
 * "Mark complete" / "Approve" on claimed-but-deps-blocked tasks
 * instead of relying on the substrate's `DependenciesOpenError`
 * thrown post-tap.
 *
 * Mirror of the V2.7 substrate-side check; identical behaviour
 * but read-side (no throw, no mutation) so the UI can read it
 * without round-tripping through the substrate.
 *
 * @param {object} task
 * @param {object[]} openItems
 * @param {object[]} closedItems
 * @returns {string[]}  open dep IDs (empty when all deps satisfied)
 */
export function unmetDeps(task, openItems, closedItems) {
  if (!task?.dependencies || task.dependencies.length === 0) return [];
  const closedIds = new Set(closedItems.map((t) => t.id));
  const out = [];
  for (const depId of task.dependencies) {
    if (!closedIds.has(depId)) out.push(depId);
  }
  return out;
}

/**
 * Detect whether adding/updating `task` (with `task.dependencies`)
 * would create a cycle in the DAG.  Returns null if no cycle, or
 * the cycle path as an array of task ids.
 *
 * @param {object} task          the task being added/updated
 * @param {object[]} allTasks    all known tasks
 * @returns {string[]|null}      cycle path or null
 */
export function detectCycle(task, allTasks) {
  if (!task?.dependencies || task.dependencies.length === 0) return null;
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  byId.set(task.id, task);                          // upsert the task being checked

  const visiting = new Set();
  const visited  = new Set();

  /**
   * @param {string} id
   * @param {string[]} path
   * @returns {string[]|null}
   */
  function walk(id, path) {
    if (visiting.has(id)) {
      // Found a cycle; truncate path to the cycle portion.
      const ix = path.indexOf(id);
      return ix === -1 ? [...path, id] : path.slice(ix).concat(id);
    }
    if (visited.has(id)) return null;
    const t = byId.get(id);
    if (!t) return null;
    visiting.add(id);
    for (const dep of t.dependencies ?? []) {
      const cycle = walk(dep, [...path, id]);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    visited.add(id);
    return null;
  }

  return walk(task.id, []);
}

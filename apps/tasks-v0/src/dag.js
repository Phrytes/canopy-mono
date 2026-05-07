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

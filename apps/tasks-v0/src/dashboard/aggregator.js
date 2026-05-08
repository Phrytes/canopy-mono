/**
 * aggregator — Tasks V2.5 cross-crew dashboard.
 *
 * Pure function over a list of crew bundles. For each one, projects:
 *   { crewId, name, kind, counts: {open, overdue, awaitingApproval, mine} }
 *
 * Counts:
 *   - open               — items with no `completedAt` (excl. subtask-request)
 *   - overdue            — open AND `dueAt < now`
 *   - awaitingApproval   — open AND status === 'submitted' AND approver === actor
 *                          (admin/coord see all submitted items)
 *   - mine               — open AND `assignee === actor`
 *
 * `aggregateCrews({crews, actor, now?})` returns the array sorted with
 * the busiest crews first. Pure — no I/O. Caller owns Crew lifecycle.
 */

const SUBTASK_REQ = 'subtask-request';

/**
 * @typedef {object} CrewSummary
 * @property {string} crewId
 * @property {string} name
 * @property {string} kind
 * @property {{open: number, overdue: number, awaitingApproval: number, mine: number}} counts
 */

/**
 * @param {object} args
 * @param {Array<{crew: object, openTasks: object[]}>} args.crews
 *   Pre-computed input — caller (the skill or test) reads each crew's
 *   open items via the crew's ItemStore and shapes them into this list.
 * @param {string} args.actor
 * @param {(actor: string, crew: object) => string | undefined} [args.roleOf]
 *   Optional role lookup per crew. Used to decide "all submitted vs
 *   only the ones I'd approve". Defaults to a no-op (member view).
 * @param {number} [args.now=Date.now()]
 * @returns {CrewSummary[]}
 */
export function aggregateCrews({ crews, actor, roleOf, now = Date.now() }) {
  if (!Array.isArray(crews)) throw new TypeError('crews[] required');
  if (typeof actor !== 'string' || !actor) throw new TypeError('actor required');

  const out = [];
  for (const entry of crews) {
    const crew = entry?.crew ?? {};
    const tasks = entry?.openTasks ?? [];
    const role  = typeof roleOf === 'function' ? roleOf(actor, crew) : 'member';

    let open = 0;
    let overdue = 0;
    let awaitingApproval = 0;
    let mine = 0;

    for (const t of tasks) {
      if (t?.type === SUBTASK_REQ) continue;
      open++;
      if (Number.isFinite(t?.dueAt) && t.dueAt < now) overdue++;
      const isSubmitted = !!(t?.reviewLog ?? []).some((e) => e?.decision === 'submit') &&
        !(t?.reviewLog ?? []).some((e) => e?.decision === 'approve');
      if (isSubmitted) {
        if (role === 'admin' || role === 'coordinator') awaitingApproval++;
        else if ((t?.master ?? t?.addedBy) === actor) awaitingApproval++;
      }
      if (t?.assignee === actor) mine++;
    }

    out.push({
      crewId: crew.crewId ?? 'unknown',
      name:   crew.name ?? crew.crewId ?? 'unknown',
      kind:   crew.kind ?? 'household',
      counts: { open, overdue, awaitingApproval, mine },
    });
  }

  // Sort busiest first (open desc, then overdue desc, then name asc for stability).
  out.sort((a, b) => {
    if (b.counts.open    !== a.counts.open)    return b.counts.open    - a.counts.open;
    if (b.counts.overdue !== a.counts.overdue) return b.counts.overdue - a.counts.overdue;
    return String(a.name).localeCompare(String(b.name));
  });

  return out;
}

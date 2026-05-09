/**
 * taskStatus — pure helpers that compute UI state from a task item.
 *
 * Phase 41.4 (2026-05-09).
 *
 * The V2.7 substrate gate (`enforceDependencies`) emits a `status`
 * field on listOpen output. The UI maps that into:
 *   - `kind`     — short label ('ready' | 'waiting' | 'blocked' | 'claimed' | 'submitted' | 'complete' | 'rejected')
 *   - `colorKey` — theme token to use for the pill ('info' | 'warning' | 'danger' | 'primary' | 'success' | 'textMuted')
 *   - `depsBlocked` — true when the V2.7 dependency gate would
 *                     reject `markComplete` / `approve` calls
 *   - `canClose`   — true when "Mark complete" / "Approve" is allowed
 *                     (NOT depsBlocked AND status is closable)
 *   - `openDepIds` — the substrate's listOpen carries `openDeps[]`
 *                     when status === 'waiting'; we surface that as
 *                     short ids for the disabled-button tooltip.
 */

/** @typedef {'ready'|'waiting'|'blocked'|'claimed'|'submitted'|'complete'|'rejected'|'unknown'} StatusKind */

/**
 * @param {object} item   listOpen item from Tasks ItemStore
 * @returns {{
 *   kind: StatusKind,
 *   label: string,
 *   colorKey: 'info'|'warning'|'danger'|'primary'|'success'|'textMuted',
 *   depsBlocked: boolean,
 *   canClose: boolean,
 *   openDepIds: string[],
 *   isAssignee: (actor: string) => boolean,
 *   isMaster:   (actor: string) => boolean,
 * }}
 */
export function describeTaskStatus(item) {
  const kind = _normaliseKind(item?.status);
  const depsBlocked = kind === 'waiting' || kind === 'blocked';
  const canClose = !depsBlocked && (kind === 'claimed' || kind === 'submitted');
  const openDepIds = Array.isArray(item?.openDeps) ? item.openDeps.map(_shortId) : [];
  return {
    kind,
    label: _LABELS[kind],
    colorKey: _COLOR[kind],
    depsBlocked,
    canClose,
    openDepIds,
    isAssignee: (actor) => typeof actor === 'string' && actor === item?.assignee,
    isMaster:   (actor) => typeof actor === 'string' &&
                            (actor === item?.master || actor === item?.addedBy),
  };
}

/**
 * "Add sub-task" → "Propose sub-task" gate, per V2.7.
 *
 * @param {object} item       parent item
 * @param {string} actor      caller's webid
 */
export function shouldProposeSubtask(item, actor) {
  if (!item || typeof actor !== 'string') return false;
  if (item.status !== 'submitted') return false;
  return item.assignee && item.assignee !== actor;
}

/**
 * Force-complete UI gate — admin-only, with a mandatory reason.
 * Returns true when the "Force complete" button should render.
 *
 * @param {object} item
 * @param {string} actor      caller's webid
 * @param {string} role       caller's role in the active crew
 */
export function shouldOfferForceComplete(item, actor, role) {
  if (!item) return false;
  if (role !== 'admin' && role !== 'coordinator') return false;
  const status = describeTaskStatus(item);
  return status.depsBlocked && status.kind !== 'complete';
}

// ── Internals ─────────────────────────────────────────────────────────────

function _normaliseKind(s) {
  if (typeof s !== 'string' || !s) return 'unknown';
  if (s === 'ready' || s === 'waiting' || s === 'blocked' ||
      s === 'claimed' || s === 'submitted' || s === 'complete' ||
      s === 'rejected') return s;
  return 'unknown';
}

const _LABELS = {
  ready:     'ready',
  waiting:   'waiting',
  blocked:   'blocked',
  claimed:   'claimed',
  submitted: 'submitted',
  complete:  'complete',
  rejected:  'rejected',
  unknown:   '—',
};

const _COLOR = {
  ready:     'info',
  waiting:   'warning',
  blocked:   'danger',
  claimed:   'primary',
  submitted: 'success',
  complete:  'textMuted',
  rejected:  'danger',
  unknown:   'textMuted',
};

function _shortId(id) {
  if (typeof id !== 'string') return '?';
  // urn:uuid:<...> → last 6 of the uuid; everything else → last 6 chars.
  const last = id.slice(-6);
  return last;
}

export const _internal = { _normaliseKind, _shortId, _LABELS, _COLOR };

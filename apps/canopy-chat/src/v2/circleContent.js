/**
 * canopy-chat v2 — circle content loader (shared web + mobile, F1 / 0.5b).
 *
 * Populates a circle's detail view with its items, reusing EXISTING
 * list ops (no new ops): bulletin/feed posts, tasks, notes. Best-effort
 * and fault-tolerant — a missing/erroring op contributes nothing. The
 * circle id is passed as args (so ops that scope server-side do), and
 * results are scoped client-side via the same rule as `scopeItems`:
 * keep items whose circle hint matches, plus items with no per-item
 * hint (assume the op already scoped them).
 *
 * Wiring status (as of 5.3d, 2026-05-30):
 *   - getBulletin → stoop.listOpen (alias in realAgent.STOOP_OP_ALIAS).
 *     Posts created in canopy-chat carry the active circle id under
 *     `source.targets[]`; the listOpen adapter surfaces that as a
 *     top-level `groupId` so `keepForCircle` can separate circles.
 *   - getFeed — ASPIRATIONAL.  Deliberately NOT aliased — would route
 *     to the same stoop.listOpen as getBulletin and duplicate every
 *     post in the flat result.  Kept in DEFAULT_SOURCES so a future
 *     dedicated feed substrate (separate from bulletin posts) can
 *     wire it without a contract change.
 *   - getMyTasks → tasks-v0.listOpen (5.3b, via TASKS_OP_ALIAS).
 *   - listNotes — ASPIRATIONAL.  No app exposes a `listNotes` skill
 *     today (no notes substrate in canopy-chat).  The resolver returns
 *     null for every origin, so this contributes nothing — a future
 *     substrate-authoring slice can wire it without changing this
 *     contract.
 */
import { isInCircle } from './circleScope.js';

const DEFAULT_SOURCES = [
  { op: 'getBulletin', kind: 'post', pick: (r) => r?.posts ?? r?.bulletin ?? r?.items },
  { op: 'getFeed',     kind: 'post', pick: (r) => r?.feed ?? r?.items },
  { op: 'getMyTasks',  kind: 'task', pick: (r) => r?.tasks ?? r?.items },
  { op: 'listNotes',   kind: 'note', pick: (r) => r?.notes ?? r?.items },
];

export function normalizeContentItem(raw = {}, kind = null) {
  const id = raw.id ?? raw.taskId ?? raw.postId ?? raw.noteId ?? null;
  return {
    id,
    label: raw.title ?? raw.text ?? raw.name ?? raw.summary ?? (id != null ? String(id) : ''),
    kind: raw.kind ?? kind ?? null,
    circleId: raw.circleId,
    crewId: raw.crewId,
    groupId: raw.groupId,
    audience: raw.audience,
  };
}

function keepForCircle(item, circleId) {
  if (!circleId) return true;
  const hasHint =
    item.circleId != null || item.crewId != null || item.groupId != null || item.audience != null;
  if (!hasHint) return true; // op already scoped via args — trust it
  return isInCircle(item, circleId);
}

export async function loadCircleItems({ callSkill, circleId, sources = DEFAULT_SOURCES } = {}) {
  if (typeof callSkill !== 'function') return [];
  const args = circleId ? { circleId, crewId: circleId, groupId: circleId } : {};
  const lists = await Promise.all(
    sources.map(async (s) => {
      try {
        const res = await callSkill(s.op, args);
        const arr = s.pick(res);
        return Array.isArray(arr) ? arr.map((r) => normalizeContentItem(r, s.kind)) : [];
      } catch {
        return [];
      }
    }),
  );
  return lists.flat().filter((it) => keepForCircle(it, circleId));
}

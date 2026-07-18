/**
 * lifecycleControls — pure helper deciding which circle-lifecycle CTAs
 * a given role may see, given the circle's current paused/archived
 * state.
 *
 * Task (2026-05-24).
 *
 * Mirrors the substrate gating in
 * `apps/tasks-v0/src/skills/circleControls.js`:
 *
 *   - pauseCircle / unpauseCircle  → admin OR coordinator
 *   - archiveCircle / unarchiveCircle → admin only
 *
 * Members + observers see no toggles (just a read-only label, surfaced
 * by `LifecycleSection`'s render path).
 *
 * Inputs:
 *   - role      — 'admin' | 'coordinator' | 'member' | 'observer' | null
 *   - paused    — boolean
 *   - archived  — boolean
 *
 * Output: `{ stateKey, canPause, canUnpause, canArchive, canUnarchive,
 *            showAnyControl, showReadOnly }`.
 *
 * `showAnyControl` is true iff the caller has at least one available
 * action right now; `showReadOnly` is true iff the caller has zero
 * available actions AND zero gated-by-state actions — in practice this
 * is the member/observer path.
 */

export function lifecycleControlsFor({ role, paused, archived } = {}) {
  const stateKey = archived ? 'archived' : paused ? 'paused' : 'active';

  const isAdmin       = role === 'admin';
  const isAdminOrCoord = role === 'admin' || role === 'coordinator';

  // pause/unpause: admin OR coordinator, never both visible at once.
  const canPause   = isAdminOrCoord && !archived && !paused;
  const canUnpause = isAdminOrCoord && !archived &&  paused;

  // archive/unarchive: admin-only, never both visible at once.
  const canArchive   = isAdmin && !archived;
  const canUnarchive = isAdmin &&  archived;

  const showAnyControl = canPause || canUnpause || canArchive || canUnarchive;

  // Read-only label appears only for non-privileged callers.
  // (Admins / coords always see at least one CTA because at least one
  // state transition is always legal for them.)
  const showReadOnly = !isAdminOrCoord;

  return {
    stateKey,
    canPause,
    canUnpause,
    canArchive,
    canUnarchive,
    showAnyControl,
    showReadOnly,
  };
}

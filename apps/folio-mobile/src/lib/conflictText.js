/**
 * conflictText — pure helpers for parsing/splitting conflict-marker
 * files.  Lives outside the screen so unit tests can exercise it
 * without touching React.
 */

export const CONFLICT_MARKER_OURS  = '<<<<<<<';
export const CONFLICT_MARKER_MID   = '=======';
export const CONFLICT_MARKER_THEIRS = '>>>>>>>';

/**
 * Split a conflict file (with `<<<<<<<` / `=======` / `>>>>>>>`
 * markers) into two text buffers.  When multiple hunks are present,
 * all "ours" halves are concatenated, then all "theirs" halves.  The
 * non-conflict text outside the hunks is included in BOTH halves so
 * the user always sees a runnable file.
 *
 * @param {string} text
 * @returns {{ mine: string, theirs: string }}
 */
export function splitConflictText(text) {
  const lines = String(text ?? '').split('\n');
  /** @type {string[]} */ const mine   = [];
  /** @type {string[]} */ const theirs = [];
  let phase = 'normal';   // normal | mine | theirs
  for (const line of lines) {
    if (line.startsWith(CONFLICT_MARKER_OURS))   { phase = 'mine';   continue; }
    if (line.startsWith(CONFLICT_MARKER_MID))    { phase = 'theirs'; continue; }
    if (line.startsWith(CONFLICT_MARKER_THEIRS)) { phase = 'normal'; continue; }
    if (phase === 'normal') { mine.push(line); theirs.push(line); }
    else if (phase === 'mine')   mine.push(line);
    else if (phase === 'theirs') theirs.push(line);
  }
  return { mine: mine.join('\n'), theirs: theirs.join('\n') };
}

/** True iff the text contains conflict markers. */
export function hasConflictMarkers(text) {
  return typeof text === 'string' && text.includes(CONFLICT_MARKER_OURS);
}

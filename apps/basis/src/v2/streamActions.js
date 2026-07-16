/**
 * basis v2 — Stream per-row action buttons (board 5B, slice P6.M3).
 *
 * Board 5B shows action buttons under each Stream row depending on the
 * event type: "Ik help" / "Negeer" on a question, "Ik doe ze" on a
 * household chore.  This module decides which buttons to render for a
 * given Stream row + describes the pinned compose's context.  Pure;
 * the renderer wires the resulting `{id, label, action, payload}` to
 * dispatch.
 *
 * Why split this from the existing `buildCircleStream`?  The row
 * projection (2.1) keeps the audit-trail shape; this is the action
 * layer that lives on TOP of the row.  Keeps both layers pure +
 * testable.
 */

const KIND_CHIPS = {
  question:    ['help', 'ignore'],
  vraag:       ['help', 'ignore'],
  borrow:      ['offer', 'ignore'],
  leen:        ['offer', 'ignore'],
  aanbod:      ['take', 'ignore'],
  chore:       ['claim', 'snooze'],
  reminder:    ['done', 'snooze'],
};

const ACTION_DEFS = {
  help:   { label: 'circle.streamAction.help'   },
  offer:  { label: 'circle.streamAction.offer'  },
  take:   { label: 'circle.streamAction.take'   },
  claim:  { label: 'circle.streamAction.claim'  },
  done:   { label: 'circle.streamAction.done'   },
  snooze: { label: 'circle.streamAction.snooze' },
  ignore: { label: 'circle.streamAction.ignore' },
};

/**
 * Pick the action buttons for a Stream row.
 *
 * @param {object} row  product of `buildCircleStream`: `{type, event:
 *                      {payload: {kind?, text?, …}}}` etc.
 * @returns {Array<{id:string, label:string, action:string, payload:object}>}
 */
export function actionsForStreamRow(row) {
  if (!row || typeof row !== 'object') return [];
  const ev = row.event && typeof row.event === 'object' ? row.event : {};
  const payload = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
  const kindKey = pickKindKey(row, ev, payload);
  const chips = KIND_CHIPS[kindKey] ?? [];
  return chips.map((action) => ({
    id:      `${row.id ?? ev.id ?? 'row'}-${action}`,
    action,
    label:   ACTION_DEFS[action]?.label ?? `circle.streamAction.${action}`,
    payload: { rowId: row.id ?? null, circleId: row.circleId ?? null, kind: kindKey, ref: payload.ref ?? null },
  }));
}

function pickKindKey(row, ev, payload) {
  const cands = [payload.kind, ev.type, row.type, ev.kind];
  for (const c of cands) {
    if (typeof c === 'string' && c.trim() && KIND_CHIPS[c.toLowerCase()]) {
      return c.toLowerCase();
    }
  }
  return null;
}

/**
 * Build the pinned-compose context shown at the bottom of the Stream.
 * The compose follows the focused row's circle context — the placeholder
 * + the post target are derived from whichever row is in focus.
 *
 * @param {object} args
 * @param {object|null} args.focusedRow  the Stream row currently focused (or null = no focus)
 * @param {function} args.t              host translator
 * @returns {{
 *   targetCircleId: string|null,
 *   targetCircleName: string|null,
 *   placeholder: string,
 *   replyToId: string|null,
 * }}
 */
export function buildStreamComposeContext({ focusedRow, t } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  if (!focusedRow || typeof focusedRow !== 'object') {
    return {
      targetCircleId:   null,
      targetCircleName: null,
      placeholder:      tr('circle.stream.compose_placeholder_default'),
      replyToId:        null,
    };
  }
  const cid = typeof focusedRow.circleId === 'string' ? focusedRow.circleId : null;
  const cName = typeof focusedRow.circleName === 'string' ? focusedRow.circleName : null;
  return {
    targetCircleId:   cid,
    targetCircleName: cName,
    placeholder: cName
      ? tr('circle.stream.compose_placeholder_targeted', { circle: cName })
      : tr('circle.stream.compose_placeholder_default'),
    replyToId: focusedRow.id ?? null,
  };
}

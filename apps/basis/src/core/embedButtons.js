/**
 * Portable embed-card button computation.  Bundle H Phase 3 (#270,
 * 2026-05-27) — lifted from `apps/basis/src/web/domAdapter.js:602`
 * so basis-mobile can surface the same `appliesTo`-gated action
 * buttons (Q28 button surfaces) on time-card / file-card embeds.
 *
 * Walks the embed's appOrigin manifest, picks operations whose
 * `surfaces.ui.control === 'button'` and whose `appliesTo` filter
 * matches the embed's snapshot.  Returns `{label, callbackData, opId,
 * itemId}` per button — the caller picks how to render (DOM button,
 * RN TouchableOpacity, …) and how the tap dispatches.
 *
 * State guard: the canonical state is `snapshot.state`, NOT
 * `snapshot.fields.state` — applying `appliesTo` uses the same item
 * merge as `apps/basis/src/embed.js`.
 */

/**
 * @typedef {object} EmbedButton
 * @property {string} label
 * @property {string} callbackData   '<opId>:<itemId>' (web's onButtonTap shape)
 * @property {string} opId
 * @property {string} itemId
 *
 * @param {object} args
 * @param {Object<string, object>}    args.manifestsByOrigin
 * @param {object}                    args.embed     `{appOrigin, snapshot, ...}` envelope
 * @returns {EmbedButton[]}
 */
export function computeEmbedButtons({ manifestsByOrigin, embed } = {}) {
  if (!manifestsByOrigin || !embed?.appOrigin) return [];
  const manifest = manifestsByOrigin[embed.appOrigin];
  if (!manifest) return [];
  const snap = embed.snapshot ?? {};
  // Same canonical-state guard as src/embed.js — fields must not
  // override snapshot.state.
  const item = {
    ...(snap.fields ?? {}),
    id:    snap.id,
    type:  snap.type,
    state: snap.state,
  };
  const out = [];
  for (const op of manifest.operations ?? []) {
    const ui = op?.surfaces?.ui;
    if (!ui || ui.control !== 'button') continue;
    if (!_embedAppliesTo(op.appliesTo, item)) continue;
    out.push({
      label:        ui.label ?? op.id,
      callbackData: `${op.id}:${item.id}`,
      opId:         op.id,
      itemId:       String(item.id ?? ''),
    });
  }
  return out;
}

function _embedAppliesTo(appliesTo, item) {
  if (!appliesTo) return true;
  if (!item || typeof item !== 'object') return false;
  if (appliesTo.type !== undefined) {
    const types = Array.isArray(appliesTo.type) ? appliesTo.type : [appliesTo.type];
    if (!types.includes(item.type)) return false;
  }
  if (appliesTo.state !== undefined) {
    const states = Array.isArray(appliesTo.state) ? appliesTo.state : [appliesTo.state];
    if (!states.includes(item.state)) return false;
  }
  return true;
}

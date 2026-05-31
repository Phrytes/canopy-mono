/**
 * canopy-chat v2 — block registry + content materializer (Plan α.1b).
 *
 * The recipe model (α.1a) stores block descriptors `{id, type, config}`.
 * This module turns each descriptor into a normalized content payload
 * the platform renderers (web DOM, RN) consume.  Data fetching uses
 * the existing host seams (`callSkill`, `eventLog`, `circles`) so we
 * don't duplicate plumbing per platform.
 *
 * Normalized output shape per block (`materializeBlock` resolves to):
 *
 *   {
 *     blockId:   <string>,        // copied from the recipe entry
 *     type:      <BLOCK_TYPE>,
 *     status:    'ok' | 'empty' | 'error',
 *     title?:    <string>,        // optional, set by some types
 *     content:   <type-specific>, // see per-type sections below
 *     error?:    <string>,        // only when status === 'error'
 *   }
 *
 *   announcement  content: { text }
 *   text          content: { text }
 *   photo         content: { src, caption }
 *   noticeboard   content: { items: Array<StreamRow> }
 *   agenda        content: { items: Array<{id, label, type, state}> }
 *   rules         content: { rules: <itemOrNull>, doc: <normalizedRulesDoc> }
 *
 * Pure / portable: zero DOM, zero RN.  All async work goes through the
 * injected `hostOps` so tests can mock with a Promise.resolve stub.
 */

import { BLOCK_TYPES } from './kringRecipe.js';
import { buildKringStream } from './circleStream.js';
import { normalizeRulesDoc, isRulesEmpty } from './circleRules.js';

/**
 * Editor-side metadata per block type.  Drives the palette + the
 * default ordering shown in α.1d's editor.  `labelKey` resolves via
 * the standard `t()` localizer (locale keys land with α.1d).
 */
export const BLOCK_REGISTRY = Object.freeze({
  announcement: { order: 1, labelKey: 'circle.recipe.block.announcement', emoji: '📣' },
  noticeboard:  { order: 2, labelKey: 'circle.recipe.block.noticeboard',  emoji: '📌' },
  agenda:       { order: 3, labelKey: 'circle.recipe.block.agenda',       emoji: '📅' },
  rules:        { order: 4, labelKey: 'circle.recipe.block.rules',        emoji: '📜' },
  photo:        { order: 5, labelKey: 'circle.recipe.block.photo',        emoji: '🖼️' },
  text:         { order: 6, labelKey: 'circle.recipe.block.text',         emoji: '✏️' },
});

/**
 * Materialize a single block.  Returns a Promise resolving to the
 * normalized shape above.  Never throws — type-level errors land in
 * `{status:'error', error}` so the renderer can show a per-block
 * fallback instead of breaking the whole page.
 *
 * @param {object} args
 * @param {{id: string, type: string, config: object}} args.block
 * @param {string} args.circleId          which kring the recipe belongs to
 * @param {object} args.hostOps           { callSkill, eventLog, circles }
 * @returns {Promise<object>}
 */
export async function materializeBlock({ block, circleId, hostOps = {} } = {}) {
  if (!block || typeof block !== 'object') return errorOut('?', '?', 'block missing');
  if (!BLOCK_TYPES.includes(block.type)) return errorOut(block.id, block.type, 'unknown type');
  try {
    switch (block.type) {
      case 'announcement': return materializeAnnouncement(block);
      case 'text':         return materializeText(block);
      case 'photo':        return materializePhoto(block);
      case 'noticeboard':  return materializeNoticeboard(block, circleId, hostOps);
      case 'agenda':       return await materializeAgenda(block, hostOps);
      case 'rules':        return await materializeRules(block, circleId, hostOps);
      default:             return errorOut(block.id, block.type, 'unhandled type');
    }
  } catch (err) {
    return errorOut(block.id, block.type, String(err?.message ?? err));
  }
}

/**
 * Materialize a whole recipe — convenience wrapper that runs blocks in
 * parallel and preserves order.  Renderers can call this once and
 * iterate the result.
 *
 * @returns {Promise<Array<object>>}  one normalized entry per block (in order)
 */
export async function materializeRecipe({ recipe, circleId, hostOps } = {}) {
  const blocks = Array.isArray(recipe?.blocks) ? recipe.blocks : [];
  if (blocks.length === 0) return [];
  return Promise.all(blocks.map((block) => materializeBlock({ block, circleId, hostOps })));
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Per-type materializers                                                 */
/* ─────────────────────────────────────────────────────────────────────── */

function materializeAnnouncement(block) {
  const text = stringOr(block.config?.text, '').trim();
  return {
    blockId: block.id, type: 'announcement',
    status: text ? 'ok' : 'empty',
    content: { text },
  };
}

function materializeText(block) {
  const text = stringOr(block.config?.text, '').trim();
  return {
    blockId: block.id, type: 'text',
    status: text ? 'ok' : 'empty',
    content: { text },
  };
}

function materializePhoto(block) {
  const src     = stringOr(block.config?.src,     '').trim();
  const caption = stringOr(block.config?.caption, '').trim();
  return {
    blockId: block.id, type: 'photo',
    status: src ? 'ok' : 'empty',
    content: { src, caption },
  };
}

function materializeNoticeboard(block, circleId, { eventLog, circles } = {}) {
  const limit = clampInt(block.config?.limit, 1, 50, 5);
  let rows = [];
  if (eventLog?.query && circleId) {
    const events = eventLog.query({ excludeMuted: true });
    const stream = buildKringStream({ events, circles: circles ?? [], circleId });
    // buildKringStream returns newest-first; cap to `limit`.
    rows = stream.slice(0, limit);
  }
  return {
    blockId: block.id, type: 'noticeboard',
    status: rows.length > 0 ? 'ok' : 'empty',
    content: { items: rows },
  };
}

async function materializeAgenda(block, { callSkill } = {}) {
  const limit       = clampInt(block.config?.limit,       1, 50,  5);
  const horizonDays = clampInt(block.config?.horizonDays, 1, 365, 14);
  if (typeof callSkill !== 'function') {
    return { blockId: block.id, type: 'agenda', status: 'empty', content: { items: [] } };
  }
  const res = await callSkill('calendar', 'listEvents', { days: horizonDays });
  const items = Array.isArray(res?.items) ? res.items.slice(0, limit) : [];
  return {
    blockId: block.id, type: 'agenda',
    status: items.length > 0 ? 'ok' : 'empty',
    content: { items },
  };
}

async function materializeRules(block, circleId, { callSkill } = {}) {
  if (typeof callSkill !== 'function' || !circleId) {
    return { blockId: block.id, type: 'rules', status: 'empty', content: { rules: null, doc: normalizeRulesDoc(null) } };
  }
  const res = await callSkill('stoop', 'getGroupRules', { groupId: circleId });
  const rules = res?.rules ?? null;
  // Rules doc lives on the stoop item under source.doc (created by the
  // rules wizard); fall through to a top-level `doc` for any legacy
  // shape and let normalizeRulesDoc fill in the canonical fields.
  const docRaw = rules?.source?.doc ?? rules?.doc ?? null;
  const doc = normalizeRulesDoc(docRaw);
  return {
    blockId: block.id, type: 'rules',
    status: isRulesEmpty(doc) ? 'empty' : 'ok',
    content: { rules, doc },
  };
}

/* ─────────────────────────────────────────────────────────────────────── */

function errorOut(blockId, type, message) {
  return { blockId, type, status: 'error', content: {}, error: message };
}

function stringOr(v, fallback) {
  return typeof v === 'string' ? v : fallback;
}

function clampInt(v, lo, hi, fallback) {
  const n = typeof v === 'number' && Number.isFinite(v) ? (v | 0) : fallback;
  return Math.max(lo, Math.min(hi, n));
}

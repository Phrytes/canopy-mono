/**
 * canopy-chat v2 — kring scherm "recipe" model (Plan α.1a · audit gap #1).
 *
 * A recipe is the admin-defined ordered list of blocks that compose
 * the scherm-mode page for a kring (v2 PDF §2 "RECEPT · SCHERM-
 * WEERGAVE INRICHTEN").  The chat view is a separate surface; the
 * recipe is what `viewMode === 'scherm'` renders.
 *
 * Shape:
 *
 *   {
 *     blocks: [
 *       { id: 'b-<...>', type: 'announcement', config: { text: '…' } },
 *       { id: 'b-<...>', type: 'noticeboard',  config: { limit: 5 } },
 *       …
 *     ],
 *   }
 *
 * Block order is the array order — block helpers (`moveBlock`,
 * `addBlock`) preserve / mutate it explicitly so there's no separate
 * `order` field to keep in sync.
 *
 * The substrate is pure: no DOM, no RN, no module-level state.  Per-
 * type config is opaque — validators live in the renderer (α.1b's
 * materializeBlock).  Storage mirrors `circlePolicyStore`: injectable
 * load/save so the host can swap localStorage → pod io later.
 */

/** Block types the v2 PDF §2 palette exposes (in editor display order). */
export const BLOCK_TYPES = Object.freeze([
  'announcement',     // pinned admin message (free text)
  'noticeboard',      // top-N recent posts (vragen/aanbod)
  'agenda',           // upcoming calendar events
  'rules',            // rendered houseRules doc
  'photo',            // static image with optional caption
  'text',             // free-form text / markdown block
]);

/** Default config per block type — kept minimal so editors fill in. */
const DEFAULT_CONFIGS = Object.freeze({
  announcement: () => ({ text: '' }),
  noticeboard:  () => ({ limit: 5 }),
  agenda:       () => ({ limit: 5, horizonDays: 14 }),
  rules:        () => ({}),
  photo:        () => ({ src: '', caption: '' }),
  text:         () => ({ text: '' }),
});

/** Empty recipe shape — what an un-customised kring shows for scherm-mode. */
export const EMPTY_RECIPE = Object.freeze({ blocks: [] });

/**
 * Coerce any raw value into the canonical recipe shape.  Unknown
 * block types are silently dropped (forward-compat: a future
 * deployment that adds a block type renders correctly on older
 * clients without crashing — the block is just hidden).
 *
 * @param {*} raw
 * @returns {{blocks: Array<{id: string, type: string, config: object}>}}
 */
export function normalizeRecipe(raw) {
  if (!raw || typeof raw !== 'object') return { blocks: [] };
  const arr = Array.isArray(raw.blocks) ? raw.blocks : [];
  const blocks = [];
  for (const b of arr) {
    if (!b || typeof b !== 'object') continue;
    if (typeof b.type !== 'string' || !BLOCK_TYPES.includes(b.type)) continue;
    const id = typeof b.id === 'string' && b.id ? b.id : freshBlockId();
    const config = b.config && typeof b.config === 'object' ? { ...b.config } : {};
    blocks.push({ id, type: b.type, config });
  }
  return { blocks };
}

/** Default config object for a given block type (deep-copied). */
export function defaultConfigForBlock(type) {
  const fn = DEFAULT_CONFIGS[type];
  return fn ? fn() : {};
}

/**
 * Append a new block of `type` to the recipe.  Returns a NEW recipe
 * (immutable update).  Throws on unknown type.
 */
export function addBlock(recipe, type, configPatch = null) {
  if (!BLOCK_TYPES.includes(type)) {
    throw new Error(`addBlock: unknown block type "${type}"`);
  }
  const cur = normalizeRecipe(recipe);
  const config = { ...defaultConfigForBlock(type), ...(configPatch ?? {}) };
  return { blocks: [...cur.blocks, { id: freshBlockId(), type, config }] };
}

/** Remove the block with `blockId`.  No-op if not present. */
export function removeBlock(recipe, blockId) {
  const cur = normalizeRecipe(recipe);
  return { blocks: cur.blocks.filter((b) => b.id !== blockId) };
}

/**
 * Move `blockId` to `newIndex` (clamped to [0, length-1]).  No-op if
 * the block is missing or already at that index.
 */
export function moveBlock(recipe, blockId, newIndex) {
  const cur = normalizeRecipe(recipe);
  const from = cur.blocks.findIndex((b) => b.id === blockId);
  if (from < 0) return cur;
  const clamped = Math.max(0, Math.min(cur.blocks.length - 1, newIndex | 0));
  if (from === clamped) return cur;
  const next = cur.blocks.slice();
  const [moved] = next.splice(from, 1);
  next.splice(clamped, 0, moved);
  return { blocks: next };
}

/**
 * Shallow-merge `configPatch` into the block with `blockId`.  No-op
 * if the block is missing.  Returns a NEW recipe.
 */
export function updateBlock(recipe, blockId, configPatch = {}) {
  const cur = normalizeRecipe(recipe);
  const idx = cur.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return cur;
  const blocks = cur.blocks.slice();
  const block = blocks[idx];
  blocks[idx] = { ...block, config: { ...block.config, ...configPatch } };
  return { blocks };
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Storage adapter — mirrors createCirclePolicyStore's shape exactly.     */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Create a recipe store backed by an injectable {load, save} pair.
 *
 *   const store = createKringRecipeStore({ io: localStorageRecipeIo() });
 *   const recipe = await store.get(circleId);
 *   await store.update(circleId, addBlock(recipe, 'announcement'));
 */
export function createKringRecipeStore({ io = {} } = {}) {
  const { load, save } = io;
  return {
    async get(circleId) {
      let raw = null;
      try { raw = typeof load === 'function' ? await load(circleId) : null; }
      catch { raw = null; }
      return normalizeRecipe(raw);
    },
    async set(circleId, recipe) {
      const next = normalizeRecipe(recipe);
      if (typeof save === 'function') await save(circleId, next);
      return next;
    },
    async update(circleId, mutator) {
      const cur = await this.get(circleId);
      const next = normalizeRecipe(typeof mutator === 'function' ? mutator(cur) : mutator);
      if (typeof save === 'function') await save(circleId, next);
      return next;
    },
  };
}

/**
 * localStorage-backed io.  Keyed by circleId — one recipe per kring.
 *   key: `cc.circleRecipe.<circleId>`
 */
export function localStorageRecipeIo(storage = globalThis.localStorage) {
  const key = (id) => `cc.circleRecipe.${id}`;
  return {
    load: async (id) => {
      try {
        const s = storage?.getItem(key(id));
        return s ? JSON.parse(s) : null;
      } catch { return null; }
    },
    save: async (id, recipe) => {
      try { storage?.setItem(key(id), JSON.stringify(recipe)); } catch { /* quota / disabled */ }
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────── */

let _seq = 0;
function freshBlockId() {
  _seq = (_seq + 1) | 0;
  return `b-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

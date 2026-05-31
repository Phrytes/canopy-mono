/**
 * canopy-chat v2 — kring scherm "recipe book" model (Plan α.1a · audit #1).
 *
 * Per Q2: a kring can have MULTIPLE named recipes (e.g. "Standaard",
 * "Eventfocus", "Zomeruitgave").  One is marked `activeId` — that's
 * what scherm-mode (v2 §4 pill) renders.  Admins manage the library;
 * non-admins see the active recipe.  Per-user override (member picks
 * a different recipe) is a later concern that can live on top of the
 * existing memberOverride store.
 *
 * Shapes:
 *
 *   Recipe = {
 *     id:     <string>,       // stable per-recipe (UI keying + activeId)
 *     name:   <string>,       // admin-chosen label ("Standaard" / "Eventfocus")
 *     blocks: [{id, type, config}],   // ordered (array index === render order)
 *   }
 *
 *   RecipeBook = {
 *     recipes: [Recipe],      // 0..N, order = library display order
 *     activeId: <string|null>,// which recipe scherm-mode shows
 *   }
 *
 * Block types per v2 PDF §2 palette: announcement, noticeboard, agenda,
 * rules, photo, text.  Per-type config is opaque to this substrate;
 * the materializer (α.1b) interprets it.
 *
 * Storage mirrors `circlePolicyStore`: injectable load/save so the host
 * swaps localStorage → pod io later.  ONE book per kring; the book
 * holds N recipes.
 *
 * Forward-compat: normalize drops unknown block types silently so a v3
 * deployment that adds a new block type doesn't break older clients.
 */

/** Block types the v2 PDF §2 palette exposes (in editor display order). */
export const BLOCK_TYPES = Object.freeze([
  'announcement',     // pinned admin message (free text)
  'noticeboard',      // top-N recent posts (vragen/aanbod)
  'agenda',           // upcoming calendar events
  'rules',            // rendered houseRules doc
  'photo',            // static image with optional caption (folio-backed src)
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

/** Empty recipe book — what an un-customised kring shows for scherm-mode. */
export const EMPTY_RECIPE_BOOK = Object.freeze({ recipes: [], activeId: null });

/* ─────────────────────────────────────────────────────────────────────── */
/* Single-recipe helpers (operate on one Recipe at a time).               */
/* ─────────────────────────────────────────────────────────────────────── */

/** Build a fresh empty Recipe with a generated id + optional name. */
export function emptyRecipe(name = '') {
  return { id: freshRecipeId(), name: typeof name === 'string' ? name : '', blocks: [] };
}

/** Coerce raw into a canonical Recipe (mints id + name when absent). */
export function normalizeRecipe(raw) {
  if (!raw || typeof raw !== 'object') return emptyRecipe('');
  const blocks = normalizeBlocks(raw.blocks);
  return {
    id:     typeof raw.id   === 'string' && raw.id   ? raw.id   : freshRecipeId(),
    name:   typeof raw.name === 'string'             ? raw.name : '',
    blocks,
  };
}

/** Default config for a block type (deep-copied). */
export function defaultConfigForBlock(type) {
  const fn = DEFAULT_CONFIGS[type];
  return fn ? fn() : {};
}

// The block helpers below operate on the input object's `.blocks` and
// preserve every other top-level property via spread.  α.2 leans on
// this: a Screen `{id, name, kringFilter, blocks}` round-trips through
// addBlock / moveBlock / etc with kringFilter intact.

/** Append a block of `type` to a Recipe-shaped object; returns a NEW object. */
export function addBlock(recipe, type, configPatch = null) {
  if (!BLOCK_TYPES.includes(type)) {
    throw new Error(`addBlock: unknown block type "${type}"`);
  }
  const blocks = normalizeBlocks(recipe?.blocks);
  const config = { ...defaultConfigForBlock(type), ...(configPatch ?? {}) };
  return { ...(recipe ?? {}), blocks: [...blocks, { id: freshBlockId(), type, config }] };
}

/** Remove the block with `blockId`; no-op if absent. */
export function removeBlock(recipe, blockId) {
  const blocks = normalizeBlocks(recipe?.blocks);
  return { ...(recipe ?? {}), blocks: blocks.filter((b) => b.id !== blockId) };
}

/** Move `blockId` to `newIndex` (clamped to valid range). */
export function moveBlock(recipe, blockId, newIndex) {
  const blocks = normalizeBlocks(recipe?.blocks);
  const from = blocks.findIndex((b) => b.id === blockId);
  if (from < 0) return { ...(recipe ?? {}), blocks };
  const clamped = Math.max(0, Math.min(blocks.length - 1, newIndex | 0));
  if (from === clamped) return { ...(recipe ?? {}), blocks };
  const next = blocks.slice();
  const [moved] = next.splice(from, 1);
  next.splice(clamped, 0, moved);
  return { ...(recipe ?? {}), blocks: next };
}

/** Shallow-merge `configPatch` onto the block; no-op if missing. */
export function updateBlock(recipe, blockId, configPatch = {}) {
  const blocks = normalizeBlocks(recipe?.blocks);
  const idx = blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) return { ...(recipe ?? {}), blocks };
  const next = blocks.slice();
  const block = next[idx];
  next[idx] = { ...block, config: { ...block.config, ...configPatch } };
  return { ...(recipe ?? {}), blocks: next };
}

/* ─────────────────────────────────────────────────────────────────────── */
/* RecipeBook helpers (operate on the per-kring library).                 */
/* ─────────────────────────────────────────────────────────────────────── */

/** Coerce raw → canonical RecipeBook (drops malformed entries, fixes activeId). */
export function normalizeRecipeBook(raw) {
  if (!raw || typeof raw !== 'object') return { recipes: [], activeId: null };
  const arr = Array.isArray(raw.recipes) ? raw.recipes : [];
  const recipes = arr.map(normalizeRecipe);
  // activeId must reference an existing recipe; default to first when not.
  let activeId = typeof raw.activeId === 'string' ? raw.activeId : null;
  if (activeId && !recipes.some((r) => r.id === activeId)) activeId = null;
  if (!activeId && recipes.length > 0) activeId = recipes[0].id;
  return { recipes, activeId };
}

/** Add a new (empty) recipe to the book; mark it active if first. */
export function addRecipe(book, name = '') {
  const cur = normalizeRecipeBook(book);
  const recipe = emptyRecipe(name);
  const recipes = [...cur.recipes, recipe];
  const activeId = cur.activeId ?? recipe.id;
  return { recipes, activeId };
}

/** Rename a recipe in the book; no-op if missing. */
export function renameRecipe(book, recipeId, newName) {
  const cur = normalizeRecipeBook(book);
  const name = typeof newName === 'string' ? newName : '';
  const recipes = cur.recipes.map((r) => (r.id === recipeId ? { ...r, name } : r));
  return { ...cur, recipes };
}

/**
 * Remove a recipe from the book.  When the removed recipe was the
 * active one, pick the next existing recipe (first in the list) as
 * the new active; falls back to null when the book empties out.
 */
export function removeRecipe(book, recipeId) {
  const cur = normalizeRecipeBook(book);
  const recipes = cur.recipes.filter((r) => r.id !== recipeId);
  let activeId = cur.activeId;
  if (activeId === recipeId) activeId = recipes.length > 0 ? recipes[0].id : null;
  return { recipes, activeId };
}

/** Switch which recipe is active; no-op if recipeId isn't in the book. */
export function setActiveRecipe(book, recipeId) {
  const cur = normalizeRecipeBook(book);
  if (!cur.recipes.some((r) => r.id === recipeId)) return cur;
  return { ...cur, activeId: recipeId };
}

/** Resolve the active Recipe (or null when the book is empty). */
export function getActiveRecipe(book) {
  const cur = normalizeRecipeBook(book);
  if (!cur.activeId) return null;
  return cur.recipes.find((r) => r.id === cur.activeId) ?? null;
}

/**
 * Apply a mutator function to one recipe in the book.  The mutator
 * receives the current Recipe and returns a new one (use the
 * single-recipe helpers above).  No-op if recipeId is missing.
 *
 *   book = updateRecipe(book, recipeId, (r) => addBlock(r, 'announcement'));
 */
export function updateRecipe(book, recipeId, mutator) {
  const cur = normalizeRecipeBook(book);
  if (typeof mutator !== 'function') return cur;
  const idx = cur.recipes.findIndex((r) => r.id === recipeId);
  if (idx < 0) return cur;
  const recipes = cur.recipes.slice();
  recipes[idx] = normalizeRecipe(mutator(recipes[idx]));
  return { ...cur, recipes };
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Storage adapter — mirrors createCirclePolicyStore's shape exactly.     */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Per-kring RecipeBook store.  One book per kring; the book holds N
 * recipes.  Injectable {load, save} so pod io can swap in later.
 *
 *   const store = createKringRecipeStore({ io: localStorageRecipeIo() });
 *   const book = await store.get(circleId);
 *   await store.update(circleId, (cur) => addRecipe(cur, 'Standaard'));
 */
export function createKringRecipeStore({ io = {} } = {}) {
  const { load, save } = io;
  return {
    async get(circleId) {
      let raw = null;
      try { raw = typeof load === 'function' ? await load(circleId) : null; }
      catch { raw = null; }
      return normalizeRecipeBook(raw);
    },
    async set(circleId, book) {
      const next = normalizeRecipeBook(book);
      if (typeof save === 'function') await save(circleId, next);
      return next;
    },
    async update(circleId, mutator) {
      const cur = await this.get(circleId);
      const next = normalizeRecipeBook(typeof mutator === 'function' ? mutator(cur) : mutator);
      if (typeof save === 'function') await save(circleId, next);
      return next;
    },
  };
}

/** localStorage-backed io.  Key: `cc.circleRecipe.<circleId>`. */
export function localStorageRecipeIo(storage = globalThis.localStorage) {
  const key = (id) => `cc.circleRecipe.${id}`;
  return {
    load: async (id) => {
      try {
        const s = storage?.getItem(key(id));
        return s ? JSON.parse(s) : null;
      } catch { return null; }
    },
    save: async (id, book) => {
      try { storage?.setItem(key(id), JSON.stringify(book)); } catch { /* quota / disabled */ }
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Internals                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

function normalizeBlocks(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const b of arr) {
    if (!b || typeof b !== 'object') continue;
    if (typeof b.type !== 'string' || !BLOCK_TYPES.includes(b.type)) continue;
    const id = typeof b.id === 'string' && b.id ? b.id : freshBlockId();
    const config = b.config && typeof b.config === 'object' ? { ...b.config } : {};
    out.push({ id, type: b.type, config });
  }
  return out;
}

let _blockSeq = 0;
function freshBlockId() {
  _blockSeq = (_blockSeq + 1) | 0;
  return `b-${Date.now().toString(36)}-${_blockSeq.toString(36)}`;
}

let _recipeSeq = 0;
function freshRecipeId() {
  _recipeSeq = (_recipeSeq + 1) | 0;
  return `r-${Date.now().toString(36)}-${_recipeSeq.toString(36)}`;
}

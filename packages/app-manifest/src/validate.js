/**
 * Manifest validator.  Forward-additive: tolerates unknown top-level /
 * operation / param / view / surface keys; rejects only on missing
 * structure or on enum-shaped values being unknown.
 *
 * Per PLAN flag #12 (F-SP1-a, locked 2026-05-19): app-local
 * (non-canonical) item types are PERMITTED — canonical ones (in
 * `@canopy/item-types` `list()`) are recognised by `classifyItemTypes`,
 * non-canonical pass through silently.  Required for SP-1 (household
 * uses shopping/errand/repair/schedule — not in the canonical registry);
 * SP-2 introduces canonical types alongside.
 */

import { list as listCanonicalTypes } from '@canopy/item-types';

/**
 * Frozen verb allow-list mirroring `@canopy/item-store` `ItemStore`
 * methods.  Operations must declare a `verb` from this set.
 */
export const VERBS = Object.freeze([
  'add',
  'list',
  'complete',
  'remove',
  'claim',
  'reassign',
  'submit',
  'approve',
  'reject',
  'revoke',
]);

const VERB_SET   = new Set(VERBS);
const PARAM_KINDS = new Set(['string', 'number', 'boolean', 'enum']);

/** @param {string} verb */
export function isCanonicalVerb(verb) { return VERB_SET.has(verb); }

/**
 * Validate a manifest.
 *
 * @param {import('./schema.js').Manifest} manifest
 * @returns {{ ok: boolean, errors: Array<{path: string, message: string}> }}
 */
export function validateManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: [{ path: '/', message: 'manifest must be an object' }] };
  }

  if (typeof manifest.app !== 'string' || manifest.app === '') {
    errors.push({ path: '/app', message: 'app must be a non-empty string' });
  }

  if (!Array.isArray(manifest.itemTypes)) {
    errors.push({ path: '/itemTypes', message: 'itemTypes must be an array' });
  } else {
    const seen = new Set();
    manifest.itemTypes.forEach((t, i) => {
      const p = `/itemTypes/${i}`;
      if (typeof t !== 'string' || t === '') {
        errors.push({ path: p, message: 'itemType entries must be non-empty strings' });
      } else if (seen.has(t)) {
        errors.push({ path: p, message: `duplicate itemType "${t}"` });
      } else {
        seen.add(t);
      }
    });
  }

  if (!Array.isArray(manifest.operations)) {
    errors.push({ path: '/operations', message: 'operations must be an array' });
  } else {
    const ids = new Set();
    manifest.operations.forEach((op, i) => {
      validateOperation(op, `/operations/${i}`, manifest, errors, ids);
    });
  }

  if (manifest.views !== undefined) {
    if (!Array.isArray(manifest.views)) {
      errors.push({ path: '/views', message: 'views must be an array if present' });
    } else {
      const ids = new Set();
      manifest.views.forEach((v, i) => {
        validateView(v, `/views/${i}`, manifest, errors, ids);
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateOperation(op, path, manifest, errors, idSet) {
  if (!op || typeof op !== 'object') {
    errors.push({ path, message: 'operation must be an object' });
    return;
  }

  if (typeof op.id !== 'string' || op.id === '') {
    errors.push({ path: `${path}/id`, message: 'op.id must be a non-empty string' });
  } else if (idSet.has(op.id)) {
    errors.push({ path: `${path}/id`, message: `duplicate operation id "${op.id}"` });
  } else {
    idSet.add(op.id);
  }

  // F-SP1-e (locked 2026-05-19): any non-empty string is permitted; `VERBS`
  // (item-store) membership stays informational (use `isCanonicalVerb` for the
  // strict ItemStore-mapping check).  Apps may declare app-specific verbs like
  // `help` that don't map to ItemStore — parallel to F-SP1-a for item types.
  if (typeof op.verb !== 'string' || op.verb === '') {
    errors.push({
      path:    `${path}/verb`,
      message: `op.verb must be a non-empty string (got ${JSON.stringify(op.verb)})`,
    });
  }

  if (op.params !== undefined) {
    if (!Array.isArray(op.params)) {
      errors.push({ path: `${path}/params`, message: 'params must be an array if present' });
    } else {
      op.params.forEach((p, j) => validateParam(p, `${path}/params/${j}`, errors));
    }
  }

  if (op.appliesTo !== undefined) {
    if (op.appliesTo === null || typeof op.appliesTo !== 'object' || Array.isArray(op.appliesTo)) {
      errors.push({ path: `${path}/appliesTo`, message: 'appliesTo must be an object if present' });
    } else if (op.appliesTo.type !== undefined) {
      const types = Array.isArray(op.appliesTo.type) ? op.appliesTo.type : [op.appliesTo.type];
      types.forEach((t, j) => {
        const p = `${path}/appliesTo/type${Array.isArray(op.appliesTo.type) ? `/${j}` : ''}`;
        if (typeof t !== 'string') {
          errors.push({ path: p, message: 'appliesTo.type must be a string or array of strings' });
        } else if (t === '*') {
          // NavModel V0.2 (2026-05-21) — wildcard: "any of manifest.
          // itemTypes".  Permitted; rendered as itemAction in every
          // section by renderWeb's wildcard rule.
        } else if (Array.isArray(manifest.itemTypes) && !manifest.itemTypes.includes(t)) {
          errors.push({ path: p, message: `appliesTo.type "${t}" is not in manifest.itemTypes` });
        }
      });
    }
  }
}

function validateParam(p, path, errors) {
  if (!p || typeof p !== 'object') {
    errors.push({ path, message: 'param must be an object' });
    return;
  }
  if (typeof p.name !== 'string' || p.name === '') {
    errors.push({ path: `${path}/name`, message: 'param.name must be a non-empty string' });
  }
  if (!PARAM_KINDS.has(p.kind)) {
    errors.push({
      path:    `${path}/kind`,
      message: `param.kind must be one of ${[...PARAM_KINDS].join('|')} (got ${JSON.stringify(p.kind)})`,
    });
  }
  if (p.kind === 'enum') {
    if (p.of === undefined) {
      errors.push({ path: `${path}/of`, message: "param.kind='enum' requires 'of'" });
    } else if (typeof p.of === 'string') {
      if (p.of !== 'itemTypes') {
        errors.push({
          path:    `${path}/of`,
          message: `param.of string only supports 'itemTypes' (got ${JSON.stringify(p.of)})`,
        });
      }
    } else if (!Array.isArray(p.of)) {
      errors.push({ path: `${path}/of`, message: "param.of must be 'itemTypes' or an array of strings" });
    } else if (p.of.some((v) => typeof v !== 'string')) {
      errors.push({ path: `${path}/of`, message: 'param.of array must contain only strings' });
    }
  }
}

function validateView(v, path, manifest, errors, idSet) {
  if (!v || typeof v !== 'object') {
    errors.push({ path, message: 'view must be an object' });
    return;
  }
  if (typeof v.id !== 'string' || v.id === '') {
    errors.push({ path: `${path}/id`, message: 'view.id must be a non-empty string' });
  } else if (idSet.has(v.id)) {
    errors.push({ path: `${path}/id`, message: `duplicate view id "${v.id}"` });
  } else {
    idSet.add(v.id);
  }
  if (typeof v.type !== 'string' || v.type === '') {
    errors.push({ path: `${path}/type`, message: 'view.type must be a non-empty string' });
  } else if (Array.isArray(manifest.itemTypes) && !manifest.itemTypes.includes(v.type)) {
    errors.push({ path: `${path}/type`, message: `view.type "${v.type}" is not in manifest.itemTypes` });
  }
  if (typeof v.title !== 'string') {
    errors.push({ path: `${path}/title`, message: 'view.title must be a string' });
  }
}

/**
 * Informational helper: split a manifest's `itemTypes` into canonical
 * (registered in `@canopy/item-types` `list()`) vs app-local.
 *
 * `validateManifest` does NOT reject app-local types (F-SP1-a); this is
 * pure introspection for tooling / docs / debug output.
 *
 * @param {import('./schema.js').Manifest} manifest
 * @returns {{ canonical: string[], appLocal: string[] }}
 */
export function classifyItemTypes(manifest) {
  const canonicalSet = new Set(listCanonicalTypes());
  const canonical    = [];
  const appLocal     = [];
  for (const t of (manifest?.itemTypes ?? [])) {
    (canonicalSet.has(t) ? canonical : appLocal).push(t);
  }
  return { canonical, appLocal };
}

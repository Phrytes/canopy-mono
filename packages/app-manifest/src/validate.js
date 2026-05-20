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
 * @param {object} [opts]
 * @param {boolean} [opts.strict=false]
 *   V0.4 Q16 (2026-05-21) — when `true`, every `view.dataSource.skillId`
 *   AND every `view.fields[].patch.opId` must be either declared in
 *   `manifest.operations[].id` OR in the new `manifest.externalSkills`
 *   allow-list.  Catches typos (e.g. `'getMispelled'`) at manifest
 *   level.  Default: non-strict (existing tolerant behaviour).
 *
 * @returns {{ ok: boolean, errors: Array<{path: string, message: string}> }}
 */
export function validateManifest(manifest, opts = {}) {
  const errors = [];
  const strict = !!opts.strict;

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
        validateView(v, `/views/${i}`, manifest, errors, ids, strict);
      });
    }
  }

  // V0.4 Q16 (strict mode only) — `manifest.externalSkills` is the
  // forward-additive allow-list for skill ids that live outside the
  // manifest's `operations[]` (e.g. household's `listMine` from
  // buildSkills).  Validated as a string array if present; missing
  // is fine.
  if (manifest.externalSkills !== undefined) {
    if (!Array.isArray(manifest.externalSkills)) {
      errors.push({
        path:    '/externalSkills',
        message: 'externalSkills must be an array if present',
      });
    } else {
      manifest.externalSkills.forEach((s, i) => {
        if (typeof s !== 'string' || s === '') {
          errors.push({
            path:    `/externalSkills/${i}`,
            message: 'externalSkills entries must be non-empty strings',
          });
        }
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Build the set of skill ids that count as "known" for Q16 strict
 * cross-check: operations[].id ∪ externalSkills[].
 */
function knownSkillIds(manifest) {
  const set = new Set();
  if (Array.isArray(manifest.operations)) {
    for (const op of manifest.operations) {
      if (typeof op?.id === 'string') set.add(op.id);
    }
  }
  if (Array.isArray(manifest.externalSkills)) {
    for (const s of manifest.externalSkills) {
      if (typeof s === 'string') set.add(s);
    }
  }
  return set;
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

  // Q22 (V0.6, 2026-05-20) — optional `surfaces.ui.labelKey` for i18n.
  // Validate shape only; the projector decides whether to surface it.
  const uiLabelKey = op?.surfaces?.ui?.labelKey;
  if (uiLabelKey !== undefined
      && (typeof uiLabelKey !== 'string' || uiLabelKey === '')) {
    errors.push({
      path:    `${path}/surfaces/ui/labelKey`,
      message: 'surfaces.ui.labelKey must be a non-empty string if present',
    });
  }

  // Q27 (V0.8, 2026-05-20) — optional `surfaces.ui.confirm` severity
  // hint for destructive / side-effect-bearing ops.  Adapters style
  // the confirm button accordingly (red for danger, yellow for warn,
  // neutral for info).  Closes Tier C #4 (consent-gated reads).
  // Passphrase / one-shot reveals stay app-side — out of scope.
  const uiConfirm = op?.surfaces?.ui?.confirm;
  if (uiConfirm !== undefined) {
    if (!uiConfirm || typeof uiConfirm !== 'object' || Array.isArray(uiConfirm)) {
      errors.push({
        path:    `${path}/surfaces/ui/confirm`,
        message: 'surfaces.ui.confirm must be an object if present',
      });
    } else {
      if (!['info', 'warn', 'danger'].includes(uiConfirm.severity)) {
        errors.push({
          path:    `${path}/surfaces/ui/confirm/severity`,
          message: "surfaces.ui.confirm.severity must be 'info' | 'warn' | 'danger'",
        });
      }
      if (uiConfirm.message !== undefined
          && (typeof uiConfirm.message !== 'string' || uiConfirm.message === '')) {
        errors.push({
          path:    `${path}/surfaces/ui/confirm/message`,
          message: 'surfaces.ui.confirm.message must be a non-empty string if present',
        });
      }
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

function validateView(v, path, manifest, errors, idSet, strict = false) {
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

  // Q17 (V0.3, 2026-05-21) — view.shape: 'list' | 'record' (default 'list').
  // Forward-additive; existing manifests (no `shape` field) → implicit 'list'.
  if (v.shape !== undefined && v.shape !== 'list' && v.shape !== 'record') {
    errors.push({
      path: `${path}/shape`,
      message: `view.shape must be 'list' or 'record' (got ${JSON.stringify(v.shape)})`,
    });
  }

  // Q15 + Q16 (V0.3, 2026-05-21) — dataSource shape sanity check.
  // Loose verification; consumers (renderWeb / fetchSectionItems) are
  // tolerant if structure deviates.
  if (v.dataSource !== undefined) {
    if (v.dataSource === null || typeof v.dataSource !== 'object' || Array.isArray(v.dataSource)) {
      errors.push({ path: `${path}/dataSource`, message: 'view.dataSource must be an object if present' });
    } else if (typeof v.dataSource.skillId !== 'string' || v.dataSource.skillId === '') {
      errors.push({
        path: `${path}/dataSource/skillId`,
        message: 'view.dataSource.skillId must be a non-empty string',
      });
    } else if (strict) {
      // V0.4 Q16-strict — verify skillId is declared in operations[]
      // OR in the externalSkills allow-list.  Surfaces typos.
      const known = knownSkillIds(manifest);
      if (!known.has(v.dataSource.skillId)) {
        errors.push({
          path:    `${path}/dataSource/skillId`,
          message: `unknown skillId "${v.dataSource.skillId}" (not in operations[] or externalSkills[])`,
          code:    'unknown-skillId',
        });
      }
    }
    if (v.dataSource.argsFromContext !== undefined) {
      if (v.dataSource.argsFromContext === null
          || typeof v.dataSource.argsFromContext !== 'object'
          || Array.isArray(v.dataSource.argsFromContext)) {
        errors.push({
          path: `${path}/dataSource/argsFromContext`,
          message: 'view.dataSource.argsFromContext must be an object if present',
        });
      }
    }
  }

  // Q18 (V0.4) — view.fields[] for record-shape views.
  if (v.fields !== undefined) {
    if (!Array.isArray(v.fields)) {
      errors.push({ path: `${path}/fields`, message: 'view.fields must be an array if present' });
    } else if (v.shape !== 'record') {
      errors.push({
        path:    `${path}/fields`,
        message: "view.fields only meaningful when view.shape === 'record'",
      });
    } else {
      const knownIds = strict ? knownSkillIds(manifest) : null;
      v.fields.forEach((f, j) => {
        const fp = `${path}/fields/${j}`;
        if (!f || typeof f !== 'object') {
          errors.push({ path: fp, message: 'field must be an object' });
          return;
        }
        if (typeof f.name !== 'string' || f.name === '') {
          errors.push({
            path:    `${fp}/name`,
            message: 'field.name must be a non-empty string',
          });
        }
        // Q22 (V0.6, 2026-05-20) — optional `labelKey` for i18n
        // resolution.  Must be a non-empty string when present;
        // consumer-side lookup, no adapter wiring.
        if (f.labelKey !== undefined
            && (typeof f.labelKey !== 'string' || f.labelKey === '')) {
          errors.push({
            path:    `${fp}/labelKey`,
            message: 'field.labelKey must be a non-empty string if present',
          });
        }
        // Q23 (V0.6, 2026-05-20) — `field.type` is documented in
        // `renderWeb.js` (recognized set: string|number|boolean|enum|
        // object|file|image).  Validator only insists on "string when
        // present" — unknown types pass through (consumers may
        // experiment with new shapes before they're codified).
        if (f.type !== undefined && typeof f.type !== 'string') {
          errors.push({
            path:    `${fp}/type`,
            message: 'field.type must be a string if present',
          });
        }
        // Q26 (V0.7, 2026-05-20) — conditional-display gate.
        // `field.requiresField: {<otherField>: <value | value[]>}`
        // hides this field unless every named field on the record
        // matches one of the allowed values.  Same shape as
        // appliesTo.state gate; consumer-side resolution.
        if (f.requiresField !== undefined) {
          if (!f.requiresField || typeof f.requiresField !== 'object'
              || Array.isArray(f.requiresField)) {
            errors.push({
              path:    `${fp}/requiresField`,
              message: 'field.requiresField must be an object if present',
            });
          } else {
            const keys = Object.keys(f.requiresField);
            if (keys.length === 0) {
              errors.push({
                path:    `${fp}/requiresField`,
                message: 'field.requiresField must have at least one key',
              });
            }
          }
        }
        // Q25 (V0.7, 2026-05-20) — optional per-field read skill for
        // multi-skill records.  Same shape as `view.dataSource`: an
        // object with non-empty `skillId` + optional `args` object.
        // When present, adapter calls this skill to resolve the
        // field's value instead of reading from the record's
        // dataSource result.
        if (f.readSkill !== undefined) {
          if (!f.readSkill || typeof f.readSkill !== 'object' || Array.isArray(f.readSkill)) {
            errors.push({
              path:    `${fp}/readSkill`,
              message: 'field.readSkill must be an object if present',
            });
          } else {
            if (typeof f.readSkill.skillId !== 'string' || f.readSkill.skillId === '') {
              errors.push({
                path:    `${fp}/readSkill/skillId`,
                message: 'field.readSkill.skillId must be a non-empty string',
              });
            } else if (strict && knownIds && !knownIds.has(f.readSkill.skillId)) {
              errors.push({
                path:    `${fp}/readSkill/skillId`,
                message: `unknown skillId "${f.readSkill.skillId}" (not in operations[] or externalSkills[])`,
                code:    'unknown-skillId',
              });
            }
            if (f.readSkill.args !== undefined
                && (typeof f.readSkill.args !== 'object'
                    || f.readSkill.args === null
                    || Array.isArray(f.readSkill.args))) {
              errors.push({
                path:    `${fp}/readSkill/args`,
                message: 'field.readSkill.args must be an object if present',
              });
            }
          }
        }
        if (f.patch !== undefined) {
          if (!f.patch || typeof f.patch !== 'object' || Array.isArray(f.patch)) {
            errors.push({ path: `${fp}/patch`, message: 'field.patch must be an object if present' });
          } else {
            if (typeof f.patch.opId !== 'string' || f.patch.opId === '') {
              errors.push({
                path:    `${fp}/patch/opId`,
                message: 'field.patch.opId must be a non-empty string',
              });
            } else if (strict && knownIds && !knownIds.has(f.patch.opId)) {
              errors.push({
                path:    `${fp}/patch/opId`,
                message: `unknown opId "${f.patch.opId}" (not in operations[] or externalSkills[])`,
                code:    'unknown-skillId',
              });
            }
            if (typeof f.patch.argName !== 'string' || f.patch.argName === '') {
              errors.push({
                path:    `${fp}/patch/argName`,
                message: 'field.patch.argName must be a non-empty string',
              });
            }
            // Q21 (V0.5, 2026-05-22) — optional `argWrapper`.  When
            // present, must be a non-empty string; signals the adapter
            // to dispatch a wrapped patch shape
            // (`opId({[argWrapper]: {[argName]: newValue}})`).
            if (f.patch.argWrapper !== undefined
                && (typeof f.patch.argWrapper !== 'string' || f.patch.argWrapper === '')) {
              errors.push({
                path:    `${fp}/patch/argWrapper`,
                message: 'field.patch.argWrapper must be a non-empty string if present',
              });
            }
          }
        }
      });
    }
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

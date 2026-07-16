/**
 * validateRecipe — validate + normalise an AUTHORED REMOTE recipe (B #64).
 *
 * A recipe is a portable circle-configuration bundle with four sections. Each
 * maps onto a shape the `@onderling/app-manifest` / basis layers already
 * validate — we REUSE those primitives rather than re-deciding what a valid
 * atom/noun/freedom is:
 *
 *   capabilities  which (verb × noun) capabilities the circle turns on, as a
 *                 `nouns`-style map `{ <noun>: { atoms: [<atom>, …] } }`.
 *                 Nouns are checked against the `@onderling/item-types` REGISTRY
 *                 (`isRegistryType`, the same source-of-truth `validateManifest`
 *                 uses for `manifest.itemTypes`); atoms against the SDK ATOM
 *                 catalogue (`isAtom`; alias → canonicalised with a warning,
 *                 mirroring the `alias-in-nouns` discipline in `validate.js`).
 *
 *   freedoms      the admin FREEDOM TEMPLATE keyed `"<app> <atom> <noun>"` →
 *                 `{ enabled?, freedom?, consequence?, privacyFloor? }` — the
 *                 exact shape `@onderling/app-manifest` `freedom.js` resolves. We
 *                 validate the key's atom+noun (as above) and the entry against
 *                 the exported `FREEDOM_LEVELS` / `OPT_OUT_CONSEQUENCES` enums.
 *
 *   settings      per-app setting VALUES keyed `"<app>.<key>"` → value (the
 *                 shape `DEFAULT_CIRCLE_POLICY.settings` holds). STRUCTURAL
 *                 validation only (key shape + JSON-serialisable value): the
 *                 per-value schema lives in each app's `manifest.settings`, so
 *                 value-vs-schema checking is part of the DEFERRED apply seam.
 *
 *   surfaces      the surface layout — `{ features?: { <feature>: bool }, view? }`
 *                 (the `DEFAULT_CIRCLE_POLICY.features` / `view` shape).
 *                 STRUCTURAL validation only: the authoritative feature list +
 *                 view enum live in basis (`circlePolicy.js`
 *                 CIRCLE_FEATURES / CIRCLE_POLICY_ENUMS), which this package
 *                 must not depend up on — enum-matching is part of the DEFERRED
 *                 apply seam.
 *
 * Forward-additive (the house style of `validate.js`): unknown TOP-LEVEL fields
 * are tolerated with an `unknown-field` warning; unknown/malformed VALUES
 * (a non-registry noun, a non-atom verb, an out-of-enum freedom) are hard
 * issues. `ok` reflects `issues` only — warnings never flip it.
 */

import { isRegistryType, isAtom, canonicalAtom, FREEDOM_LEVELS, OPT_OUT_CONSEQUENCES } from '@onderling/app-manifest';
import { ISSUE_CODES as I, WARNING_CODES as W } from './errors.js';

const KNOWN_TOP_LEVEL = new Set(['name', 'version', 'capabilities', 'settings', 'surfaces', 'freedoms']);

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {unknown} recipe
 * @returns {{ ok: boolean, issues: Array<{path:string,code:string,message:string}>,
 *             warnings: Array<{path:string,code:string,message:string}>,
 *             recipe: object|null }}
 *   `recipe` is the NORMALISED bundle (defaults filled, atoms canonicalised) when `ok`, else null.
 */
export function validateRecipe(recipe) {
  const issues = [];
  const warnings = [];
  const push = (arr, path, code, message) => arr.push({ path, code, message });

  if (!isPlainObject(recipe)) {
    push(issues, '/', I.NOT_OBJECT, 'recipe must be a plain object');
    return { ok: false, issues, warnings, recipe: null };
  }

  for (const k of Object.keys(recipe)) {
    if (!KNOWN_TOP_LEVEL.has(k)) {
      push(warnings, `/${k}`, W.UNKNOWN_FIELD, `unknown top-level field "${k}" (tolerated, forward-additive)`);
    }
  }

  const normalised = {
    ...(typeof recipe.name === 'string' ? { name: recipe.name } : {}),
    ...(typeof recipe.version === 'string' ? { version: recipe.version } : {}),
    capabilities: {},
    settings: {},
    surfaces: {},
    freedoms: {},
  };

  // ── capabilities: { <noun>: { atoms: [<atom>…] } } ─────────────────────────
  if (recipe.capabilities !== undefined) {
    if (!isPlainObject(recipe.capabilities)) {
      push(issues, '/capabilities', I.BAD_SECTION, 'capabilities must be an object (noun → { atoms }) if present');
    } else {
      for (const [noun, decl] of Object.entries(recipe.capabilities)) {
        const np = `/capabilities/${noun}`;
        if (!isRegistryType(noun)) {
          push(issues, np, I.BAD_NOUN, `noun "${noun}" is not declared in the @onderling/item-types registry`);
        }
        if (!isPlainObject(decl)) {
          push(issues, np, I.BAD_CAP_ENTRY, 'capability entry must be an object with an `atoms` array');
          continue;
        }
        if (!Array.isArray(decl.atoms)) {
          push(issues, `${np}/atoms`, I.BAD_ATOMS_SHAPE, 'capabilities[noun].atoms must be an array');
          continue;
        }
        const outAtoms = [];
        decl.atoms.forEach((a, i) => {
          const ap = `${np}/atoms/${i}`;
          if (typeof a !== 'string' || a === '' || !isAtom(a)) {
            push(issues, ap, I.BAD_ATOM, `atom ${JSON.stringify(a)} is not an SDK atom (see @onderling/app-manifest atoms.js)`);
            return;
          }
          const canon = canonicalAtom(a);
          if (canon !== a) {
            push(warnings, ap, W.ALIAS_ATOM, `atom "${a}" is an alias — normalised to canonical "${canon}"`);
          }
          outAtoms.push(canon);
        });
        if (isRegistryType(noun)) normalised.capabilities[noun] = { atoms: [...new Set(outAtoms)] };
      }
    }
  }

  // ── freedoms: { "<app> <atom> <noun>": { enabled?, freedom?, consequence?, privacyFloor? } } ─
  if (recipe.freedoms !== undefined) {
    if (!isPlainObject(recipe.freedoms)) {
      push(issues, '/freedoms', I.BAD_SECTION, 'freedoms must be an object (freedom-template map) if present');
    } else {
      for (const [key, entry] of Object.entries(recipe.freedoms)) {
        const kp = `/freedoms/${key}`;
        const parts = key.split(' ');
        let keyOk = true;
        if (parts.length !== 3 || parts.some((p) => p === '')) {
          push(issues, kp, I.BAD_FREEDOM_KEY, `freedom key must be "<app> <atom> <noun>" (got ${JSON.stringify(key)})`);
          keyOk = false;
        } else {
          const [, atom, noun] = parts;
          if (!isAtom(atom)) { push(issues, kp, I.BAD_ATOM, `freedom key atom "${atom}" is not an SDK atom`); keyOk = false; }
          if (!isRegistryType(noun)) { push(issues, kp, I.BAD_NOUN, `freedom key noun "${noun}" is not a registry item-type`); keyOk = false; }
        }
        if (!isPlainObject(entry)) {
          push(issues, kp, I.BAD_FREEDOM_ENTRY, 'freedom entry must be an object');
          continue;
        }
        let entryOk = true;
        if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
          push(issues, `${kp}/enabled`, I.BAD_ENABLED, 'freedom.enabled must be a boolean if present'); entryOk = false;
        }
        if (entry.freedom !== undefined && !FREEDOM_LEVELS.includes(entry.freedom)) {
          push(issues, `${kp}/freedom`, I.BAD_FREEDOM, `freedom.freedom must be one of ${FREEDOM_LEVELS.join('|')}`); entryOk = false;
        }
        if (entry.consequence !== undefined && !OPT_OUT_CONSEQUENCES.includes(entry.consequence)) {
          push(issues, `${kp}/consequence`, I.BAD_CONSEQUENCE, `freedom.consequence must be one of ${OPT_OUT_CONSEQUENCES.join('|')}`); entryOk = false;
        }
        if (entry.privacyFloor !== undefined && typeof entry.privacyFloor !== 'boolean') {
          push(issues, `${kp}/privacyFloor`, I.BAD_PRIVACY_FLOOR, 'freedom.privacyFloor must be a boolean if present'); entryOk = false;
        }
        if (keyOk && entryOk) {
          const clean = {};
          for (const f of ['enabled', 'freedom', 'consequence', 'privacyFloor']) {
            if (entry[f] !== undefined) clean[f] = entry[f];
          }
          normalised.freedoms[key] = clean;
        }
      }
    }
  }

  // ── settings: { "<app>.<key>": value } — structural only (schema check deferred to apply) ─
  if (recipe.settings !== undefined) {
    if (!isPlainObject(recipe.settings)) {
      push(issues, '/settings', I.BAD_SECTION, 'settings must be an object ("<app>.<key>" → value) if present');
    } else {
      for (const [key, value] of Object.entries(recipe.settings)) {
        const sp = `/settings/${key}`;
        const dot = key.indexOf('.');
        if (dot <= 0 || dot >= key.length - 1) {
          push(issues, sp, I.BAD_SETTING_KEY, `setting key must be "<app>.<key>" (got ${JSON.stringify(key)})`);
        }
        if (!isJsonSerialisable(value)) {
          push(issues, sp, I.BAD_SETTING_VALUE, 'setting value must be JSON-serialisable (no functions/undefined/cycles)');
          continue;
        }
        normalised.settings[key] = value;
      }
    }
  }

  // ── surfaces: { features?: { <feature>: bool }, view? } — structural only (enums live in basis) ─
  if (recipe.surfaces !== undefined) {
    if (!isPlainObject(recipe.surfaces)) {
      push(issues, '/surfaces', I.BAD_SECTION, 'surfaces must be an object if present');
    } else {
      const surfaces = {};
      if (recipe.surfaces.features !== undefined) {
        if (!isPlainObject(recipe.surfaces.features)) {
          push(issues, '/surfaces/features', I.BAD_FEATURES, 'surfaces.features must be an object (feature → boolean) if present');
        } else {
          const feats = {};
          for (const [feat, on] of Object.entries(recipe.surfaces.features)) {
            if (typeof on !== 'boolean') {
              push(issues, `/surfaces/features/${feat}`, I.BAD_FEATURE, 'feature flag must be a boolean');
            } else {
              feats[feat] = on;
            }
          }
          surfaces.features = feats;
        }
      }
      if (recipe.surfaces.view !== undefined) {
        if (typeof recipe.surfaces.view !== 'string' || recipe.surfaces.view === '') {
          push(issues, '/surfaces/view', I.BAD_VIEW, 'surfaces.view must be a non-empty string if present');
        } else {
          surfaces.view = recipe.surfaces.view;
        }
      }
      normalised.surfaces = surfaces;
    }
  }

  const ok = issues.length === 0;
  return { ok, issues, warnings, recipe: ok ? normalised : null };
}

/** Cheap JSON round-trip guard (catches functions, undefined, BigInt, cycles). */
function isJsonSerialisable(value) {
  if (value === undefined) return false;
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

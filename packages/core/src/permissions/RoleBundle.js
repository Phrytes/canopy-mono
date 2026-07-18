/**
 * RoleBundle — a role as a named BUNDLE of capabilities its holder gains.
 *
 * The gap this closes (P3 / the reuse audit): today a role is only a bare id +
 * a rank (`Roles.js`: `STANDARD_RANKS` / `roleRank` / `canPromote`) plus,
 * separately, a skill's `requiredRole` gate (`PolicyEngine`). NOTHING binds a
 * role-id to the SET of capabilities a holder gains. The rank says who
 * OUTRANKS whom; it says nothing about what a holder can DO. A RoleBundle binds
 * a `Roles.js` role-id to a list of capability TEMPLATES, so the standing
 * becomes VISIBLE (others can rely on it) and MATERIALIZABLE (`RoleGrant`
 * issues the actual cap-tokens on assignment).
 *
 * This is the vocabulary layer only — it REUSES `Roles.js` as the id + rank
 * registry (a bundle must reference a known role id) and describes the grants;
 * `RoleGrant.RoleGrantManager` does the signing/materialization over
 * `CapabilityToken` + `GroupManager`, and `PolicyEngine` stays the single
 * enforcement point (no second gate).
 *
 * ── Bundle shape ────────────────────────────────────────────────────────────
 *   {
 *     id:     string,          // a Roles.js role id (standard or registered custom)
 *     rank:   number,          // roleRank(id) — kept on the bundle for quick reads
 *     grants: GrantTemplate[]  // the capabilities a holder gains
 *   }
 *
 * ── GrantTemplate — one capability, compiled into a CapabilityToken at grant
 *    time (see RoleGrant.materialize) ─────────────────────────────────────────
 *   {
 *     skill?:       string,          // skill scope: exact id, '<prefix>.*', or '*' (default '*')
 *     pod?:         string|string[], // pod scope(s), recorded in constraints.pod
 *     actingAs?:    string,          // a webid the holder may act as (constraints.actingAs)
 *     constraints?: object,          // extra constraints merged onto the issued token
 *     expiresIn?:   number,          // per-template TTL override (ms); else the grant TTL
 *   }
 *   A template must carry at least ONE of skill / pod / actingAs — an empty
 *   template grants nothing and is a definition bug.
 *
 * ── Governance folds in (Frits) ─────────────────────────────────────────────
 * `admin` is the BUILT-IN bundle "can manage this circle": its grants are the
 * circle-management capability surface (`circle.*`). One mechanism for admin /
 * warden / any custom role — governance is not a separate subsystem, it is the
 * admin bundle.
 */
import { roleRank, isKnownRole, registerCustomRole } from './Roles.js';

/** roleId → frozen bundle. */
const bundles = new Map();

/**
 * Normalise + validate one grant template. Throws on a malformed / empty
 * template so a bundle can never carry a grant that authorises nothing.
 * @param {object} g
 * @param {number} idx — position (for the error message)
 * @returns {object} the frozen template
 */
function normaliseGrant(g, idx) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) {
    throw new Error(`RoleBundle: grant[${idx}] must be an object`);
  }
  const out = {};
  if (g.skill !== undefined) {
    if (typeof g.skill !== 'string' || g.skill.length === 0) {
      throw new Error(`RoleBundle: grant[${idx}].skill must be a non-empty string`);
    }
    out.skill = g.skill;
  }
  if (g.pod !== undefined) {
    const pods = Array.isArray(g.pod) ? g.pod : [g.pod];
    if (pods.length === 0 || pods.some((p) => typeof p !== 'string' || p.length === 0)) {
      throw new Error(`RoleBundle: grant[${idx}].pod must be a non-empty string or array of them`);
    }
    out.pod = Array.isArray(g.pod) ? Object.freeze([...pods]) : g.pod;
  }
  if (g.actingAs !== undefined) {
    if (typeof g.actingAs !== 'string' || g.actingAs.length === 0) {
      throw new Error(`RoleBundle: grant[${idx}].actingAs must be a non-empty string`);
    }
    out.actingAs = g.actingAs;
  }
  if (g.constraints !== undefined) {
    if (!g.constraints || typeof g.constraints !== 'object' || Array.isArray(g.constraints)) {
      throw new Error(`RoleBundle: grant[${idx}].constraints must be an object`);
    }
    out.constraints = Object.freeze({ ...g.constraints });
  }
  if (g.expiresIn !== undefined) {
    if (typeof g.expiresIn !== 'number' || !Number.isFinite(g.expiresIn) || g.expiresIn <= 0) {
      throw new Error(`RoleBundle: grant[${idx}].expiresIn must be a finite positive number of ms`);
    }
    out.expiresIn = g.expiresIn;
  }
  if (out.skill === undefined && out.pod === undefined && out.actingAs === undefined) {
    throw new Error(`RoleBundle: grant[${idx}] must specify at least one of skill / pod / actingAs`);
  }
  return Object.freeze(out);
}

/**
 * Build (and validate) a normalised, frozen RoleBundle WITHOUT registering it.
 *
 * The `id` must resolve to a known `Roles.js` role. If it does not AND a
 * numeric `rank` is supplied, the custom role is registered first
 * (`registerCustomRole`) so the bundle always references a known role id — this
 * lets `defineRoleBundle({ id:'warden', rank:70, grants:[…] })` introduce a new
 * custom role and its capability surface in one step. When the id is already
 * known, a supplied `rank` must match its registered rank.
 *
 * @param {object} bundle
 * @param {string} bundle.id
 * @param {number} [bundle.rank]
 * @param {GrantTemplate[]} [bundle.grants]
 * @returns {{ id: string, rank: number, grants: object[] }}
 */
export function defineRoleBundle({ id, rank, grants = [] } = {}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('RoleBundle: id must be a non-empty string (a Roles.js role id)');
  }
  if (!Array.isArray(grants)) {
    throw new Error('RoleBundle: grants must be an array of grant templates');
  }

  if (!isKnownRole(id)) {
    // Unknown id — permit auto-registering it as a custom role IFF a rank is
    // given (folds the vocabulary registration into bundle definition). Without
    // a rank we cannot slot it into the hierarchy, so refuse.
    if (typeof rank !== 'number') {
      throw new Error(
        `RoleBundle: "${id}" is not a known Roles.js role — register it first `
        + '(registerCustomRole) or pass a numeric rank to auto-register it',
      );
    }
    registerCustomRole(id, rank);
  } else if (rank !== undefined && rank !== roleRank(id)) {
    throw new Error(
      `RoleBundle: rank ${rank} for "${id}" does not match its registered rank ${roleRank(id)}`,
    );
  }

  const normalised = grants.map((g, i) => normaliseGrant(g, i));
  return Object.freeze({ id, rank: roleRank(id), grants: Object.freeze(normalised) });
}

/**
 * Register a role bundle by its role id (last registration wins). Accepts a
 * raw `{ id, rank?, grants }` or an already-built bundle from `defineRoleBundle`.
 * @param {object} bundle
 * @returns {{ id: string, rank: number, grants: object[] }} the registered bundle
 */
export function registerRoleBundle(bundle) {
  const b = defineRoleBundle(bundle);
  bundles.set(b.id, b);
  return b;
}

/** @returns {object|null} the bundle registered for `roleId`, or null. */
export function getRoleBundle(roleId) {
  return bundles.get(roleId) ?? null;
}

/** @returns {boolean} whether a bundle is registered for `roleId`. */
export function hasRoleBundle(roleId) {
  return bundles.has(roleId);
}

/** @returns {object[]} all registered bundles, sorted by rank descending. */
export function listRoleBundles() {
  return [...bundles.values()].sort((a, b) => b.rank - a.rank);
}

/**
 * Remove a registered bundle. The built-in `admin` bundle is re-seeded by
 * `resetRoleBundles()` — use that in tests to restore a clean slate.
 * @param {string} roleId
 * @returns {boolean} true if a bundle was removed.
 */
export function unregisterRoleBundle(roleId) {
  return bundles.delete(roleId);
}

/**
 * The BUILT-IN governance-admin bundle: "can manage this circle." Admin's
 * capability surface is the circle-management skill namespace (`circle.*` —
 * role changes, invites, and the other governance ops). Folding governance in
 * here means admin / warden / any custom role all run through the ONE
 * bundle+materialize mechanism.
 */
export const ADMIN_ROLE_BUNDLE = defineRoleBundle({
  id:     'admin',
  grants: [{ skill: 'circle.*' }],
});

/**
 * Reset the registry to just the built-in bundles (the admin bundle). Intended
 * for test isolation, mirroring the `Roles.js` custom-role teardown pattern.
 */
export function resetRoleBundles() {
  bundles.clear();
  bundles.set(ADMIN_ROLE_BUNDLE.id, ADMIN_ROLE_BUNDLE);
}

// Seed the built-in bundle at module load.
resetRoleBundles();

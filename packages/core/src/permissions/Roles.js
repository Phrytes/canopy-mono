/**
 * Roles — standard role taxonomy + custom-role registration API.
 *
 * Locked Q-D.1 (2026-04-28): five standard roles plus an
 * app-defined-extension API. Apps can register custom role IDs with an
 * explicit numeric rank that slots them into the hierarchy.
 *
 * Hierarchy (numeric rank, higher = more privileged):
 *
 *   admin       100
 *   coordinator  80
 *   member       60
 *   observer     40
 *   external     20
 *
 * Custom role IDs may be registered with any positive numeric rank that
 * does not collide with another registered (standard or custom) role id
 * or rank.
 */

export const ROLES = Object.freeze({
  ADMIN:       'admin',
  COORDINATOR: 'coordinator',
  MEMBER:      'member',
  OBSERVER:    'observer',
  EXTERNAL:    'external',
});

/** The canonical role→rank table — the SINGLE source of truth. Any consumer
 *  that needs the standard ranks (e.g. the relay's group-auth verifier) imports
 *  this instead of hand-copying the numbers. */
export const STANDARD_RANKS = Object.freeze({
  admin:       100,
  coordinator:  80,
  member:       60,
  observer:     40,
  external:     20,
});

const STANDARD_ROLE_SET = new Set(Object.values(ROLES));

/** Custom roles registered by apps. roleId → rank. */
const customRanks = new Map();

/**
 * Whether the given role id is one of the five standard roles.
 * @param {string} role
 * @returns {boolean} true if role is one of the five standard roles.
 */
export function isStandardRole(role) {
  return typeof role === 'string' && STANDARD_ROLE_SET.has(role);
}

/**
 * Numeric rank of a standard or registered custom role (higher = more
 * privileged); undefined for unknown roles.
 * @param {string} role
 * @returns {number|undefined} numeric rank, or undefined for unknown roles.
 */
export function roleRank(role) {
  if (typeof role !== 'string') return undefined;
  if (Object.prototype.hasOwnProperty.call(STANDARD_RANKS, role)) {
    return STANDARD_RANKS[role];
  }
  return customRanks.has(role) ? customRanks.get(role) : undefined;
}

/**
 * Whether the role id is recognised — a standard role or a registered custom role.
 * @param {string} role
 * @returns {boolean} true if role is recognised (standard or registered custom).
 */
export function isKnownRole(role) {
  return roleRank(role) !== undefined;
}

/**
 * Register a custom role ID with an explicit rank.
 *
 * Throws if:
 *   - roleId collides with a standard role
 *   - roleId is already registered as a custom role
 *   - rank collides with an existing rank (standard or custom)
 *   - roleId is not a non-empty string
 *   - rank is not a finite positive number
 *
 * @param {string} roleId
 * @param {number} rank
 */
export function registerCustomRole(roleId, rank) {
  if (typeof roleId !== 'string' || roleId.length === 0) {
    throw new Error('registerCustomRole: roleId must be a non-empty string');
  }
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank <= 0) {
    throw new Error('registerCustomRole: rank must be a finite positive number');
  }
  if (STANDARD_ROLE_SET.has(roleId)) {
    throw new Error(`registerCustomRole: "${roleId}" collides with a standard role`);
  }
  if (customRanks.has(roleId)) {
    throw new Error(`registerCustomRole: "${roleId}" is already registered`);
  }
  for (const standardRank of Object.values(STANDARD_RANKS)) {
    if (standardRank === rank) {
      throw new Error(`registerCustomRole: rank ${rank} collides with a standard role`);
    }
  }
  for (const [existingId, existingRank] of customRanks.entries()) {
    if (existingRank === rank) {
      throw new Error(
        `registerCustomRole: rank ${rank} collides with custom role "${existingId}"`,
      );
    }
  }
  customRanks.set(roleId, rank);
}

/**
 * Unregister a custom role.  Throws if attempting to unregister a
 * standard role or unknown role.
 *
 * @param {string} roleId
 * @returns {boolean} true if a custom role was removed.
 */
export function unregisterCustomRole(roleId) {
  if (STANDARD_ROLE_SET.has(roleId)) {
    throw new Error(`unregisterCustomRole: cannot unregister standard role "${roleId}"`);
  }
  return customRanks.delete(roleId);
}

/**
 * Can `actorRole` promote / demote / set the role of someone currently at
 * `targetRole`?
 *
 * Rules:
 *   - admin can act on anyone (always true if actorRole is 'admin').
 *   - otherwise actor must outrank target strictly.
 *   - unknown roles return false.
 *
 * @param {string} actorRole
 * @param {string} targetRole
 * @returns {boolean}
 */
export function canPromote(actorRole, targetRole) {
  if (actorRole === ROLES.ADMIN) return true;
  const actorRank  = roleRank(actorRole);
  const targetRank = roleRank(targetRole);
  if (actorRank === undefined || targetRank === undefined) return false;
  return actorRank > targetRank;
}

/**
 * All known role ids (standard + registered custom), sorted by rank descending.
 * @returns {string[]} all known role ids (standard + custom), sorted by
 * rank descending.
 */
export function listKnownRoles() {
  const all = [
    ...Object.entries(STANDARD_RANKS),
    ...customRanks.entries(),
  ];
  all.sort((a, b) => b[1] - a[1]);
  return all.map(([roleId]) => roleId);
}

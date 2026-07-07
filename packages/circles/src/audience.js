/**
 * Audience model — the "audience → circle → group" continuum as one
 * primitive.
 *
 *   Audience =
 *       string                                  // short-hand
 *     | { kind: 'set',        members: Webid[] }
 *     | { kind: 'circle-ref', id: CircleId }
 *     | { kind: 'union',      of: Audience[]  }
 *     | { kind: 'public' }                      // sentinel — everyone
 *
 * Pure helpers — no I/O, no side effects.  All resolution-time
 * knowledge (who is `me`, who's in the household, what roles map to
 * what webids, how to look up a circle by id) is supplied via `ctx`.
 *
 * Recognised string short-hands (case-sensitive):
 *
 *   'public'           → { kind: 'public' }
 *   'private' / 'me'   → { kind: 'set', members: [ctx.me] }
 *   'household'        → { kind: 'set', members: ctx.householdMembers ?? [] }
 *   'role:NAME'        → { kind: 'set', members: ctx.roleMembers?.[NAME] ?? [] }
 *   'circle:ID'        → { kind: 'circle-ref', id: ID }
 *
 * NOTE — `circle.id` and `task.circleId` share the same string
 * identifier space.  See `CIRCLE_ID_IS_CREW_ID_ALIAS` in
 * `@canopy/item-types/src/types/circle.js`.
 */

/**
 * Sentinel returned by `resolveAudience` for the `public` audience.
 * Callers check `result === PUBLIC` rather than treating it as a set.
 */
export const PUBLIC = 'public';

/**
 * Parse string short-hands into structured form.  Already-structured
 * audiences pass through unchanged.  Unknown strings are rejected
 * (throw) — they are almost certainly a typo and silently treating
 * them as no-op leads to security-confusion bugs.
 *
 * @param {Audience} a
 * @returns {Audience} structured form
 */
export function normalizeAudience(a) {
  if (typeof a === 'string') {
    if (a === 'public')                       return { kind: 'public' };
    if (a === 'private' || a === 'me')        return { kind: 'me' };
    if (a === 'household')                    return { kind: 'household' };
    if (a.startsWith('role:')) {
      const name = a.slice(5);
      if (!name) throw new TypeError(`normalizeAudience: empty role name in "${a}"`);
      return { kind: 'role', name };
    }
    if (a.startsWith('circle:')) {
      const id = a.slice('circle:'.length);
      if (!id) throw new TypeError(`normalizeAudience: empty id in "${a}"`);
      return { kind: 'circle-ref', id };
    }
    throw new TypeError(`normalizeAudience: unknown audience short-hand "${a}"`);
  }
  if (!a || typeof a !== 'object') {
    throw new TypeError(`normalizeAudience: audience must be string or object (got ${typeof a})`);
  }
  // Structured forms — light validation only; resolveAudience does the
  // deep work and surfaces structural errors there.
  switch (a.kind) {
    case 'set':
      if (!Array.isArray(a.members)) {
        throw new TypeError("normalizeAudience: {kind:'set'} requires members[]");
      }
      return { kind: 'set', members: a.members.slice() };
    case 'circle-ref':
      if (typeof a.id !== 'string' || a.id === '') {
        throw new TypeError("normalizeAudience: {kind:'circle-ref'} requires non-empty id");
      }
      return { kind: 'circle-ref', id: a.id };
    case 'union':
      if (!Array.isArray(a.of)) {
        throw new TypeError("normalizeAudience: {kind:'union'} requires of[]");
      }
      return { kind: 'union', of: a.of.map(normalizeAudience) };
    case 'public':
    case 'me':
    case 'household':
      return { kind: a.kind };
    case 'role':
      if (typeof a.name !== 'string' || a.name === '') {
        throw new TypeError("normalizeAudience: {kind:'role'} requires non-empty name");
      }
      return { kind: 'role', name: a.name };
    default:
      throw new TypeError(`normalizeAudience: unknown kind "${a.kind}"`);
  }
}

/**
 * Resolve an audience to a concrete member set.  `ctx` supplies the
 * resolution-time knowledge:
 *
 *   ctx.me                 — caller's webid (for 'me' / 'private')
 *   ctx.householdMembers   — Webid[] (for 'household')
 *   ctx.roleMembers        — Record<roleName, Webid[]>  (for 'role:*')
 *   ctx.getCircle(id)      → Promise<Circle | null>  (for 'circle-ref')
 *
 * Returns either `PUBLIC` (the sentinel) or a `Set<Webid>`.
 *
 * `circle-ref` audiences whose circle is missing (`getCircle` returns
 * null / undefined) resolve to an *empty* set rather than throwing —
 * a deleted circle is a deleted audience, not a structural error.
 *
 * @param {Audience} audience
 * @param {object}   ctx
 * @returns {Promise<typeof PUBLIC | Set<string>>}
 */
export async function resolveAudience(audience, ctx) {
  const a = normalizeAudience(audience);
  return resolveNormalized(a, ctx ?? {});
}

async function resolveNormalized(a, ctx) {
  switch (a.kind) {
    case 'public':
      return PUBLIC;
    case 'me':
      return ctx.me ? new Set([ctx.me]) : new Set();
    case 'household':
      return new Set(ctx.householdMembers ?? []);
    case 'role': {
      const members = ctx.roleMembers?.[a.name] ?? [];
      return new Set(members);
    }
    case 'set':
      return new Set(a.members);
    case 'circle-ref': {
      if (typeof ctx.getCircle !== 'function') {
        throw new TypeError(
          `resolveAudience: {kind:'circle-ref', id:"${a.id}"} requires ctx.getCircle`,
        );
      }
      const circle = await ctx.getCircle(a.id);
      if (!circle) return new Set();
      return new Set(circle.members ?? []);
    }
    case 'union': {
      const sets = await Promise.all(a.of.map((sub) => resolveNormalized(sub, ctx)));
      // 'public' absorbs the union — a single public branch wins.
      if (sets.some((s) => s === PUBLIC)) return PUBLIC;
      const out = new Set();
      for (const s of sets) for (const m of s) out.add(m);
      return out;
    }
    default:
      // Unreachable after normalize — keep for forward-compat warning.
      throw new TypeError(`resolveAudience: unknown kind "${a.kind}"`);
  }
}

/**
 * Convenience: does `webid` belong to the resolved audience?
 *
 * @param {string}   webid
 * @param {Audience} audience
 * @param {object}   ctx     (same shape as resolveAudience)
 * @returns {Promise<boolean>}
 */
export async function inAudience(webid, audience, ctx) {
  const resolved = await resolveAudience(audience, ctx);
  if (resolved === PUBLIC) return true;
  return resolved.has(webid);
}

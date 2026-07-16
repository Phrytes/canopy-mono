// Own-vs-inherit property graph for profiles (identity step 2 — see
// plans/NOTE-identity-profiles-and-portability.md "Step-2 reconciliation map").
//
// A profile in the registry carries a `properties` map. Each property is either:
//   • OWN     — holds its own value, or
//   • INHERIT — resolves from a parent profile (`from`, or the DEFAULT profile).
// A key NOT declared on a profile IMPLICITLY inherits from the default profile — so a
// persona-face declares only its overrides and inherits the rest ("inherits everything
// except its own label/key/disclosure"). Flipping own↔inherit re-scopes with NO migration.

/** An OWN property: holds its own value. */
export function own(value) { return { mode: 'own', value }; }

/** An INHERIT property: resolves from `from` (a profileId) or, if absent, the default profile. */
export function inherit(from) { return (typeof from === 'string' && from) ? { mode: 'inherit', from } : { mode: 'inherit' }; }

/** Strict-allowlist normalise a properties map (used by the registry resource + callers). Frozen. */
export function normaliseProperties(raw) {
  if (!raw || typeof raw !== 'object') return Object.freeze({});
  const out = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.mode === 'own') out[key] = Object.freeze({ mode: 'own', value: entry.value });
    else out[key] = Object.freeze(
      (typeof entry.from === 'string' && entry.from) ? { mode: 'inherit', from: entry.from } : { mode: 'inherit' },
    );
  }
  return Object.freeze(out);
}

/**
 * Resolve the EFFECTIVE value of `key` for `profileId`, following inherit pointers up the
 * chain (an entry's `from`, or the default profile; an UNDECLARED key implicitly inherits
 * from the default) until an OWN value is found. Cycle- and dead-end-safe → `undefined`.
 *
 * @param {(id:string)=>({properties?:object}|null|undefined)} getProfile  lookup a profile by id
 * @param {string} profileId
 * @param {string} key
 * @param {{ defaultProfileId?: string|null }} [opts]
 */
export function resolveProperty(getProfile, profileId, key, { defaultProfileId = null } = {}) {
  const seen = new Set();
  let id = profileId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const entry = getProfile(id)?.properties?.[key];
    if (entry?.mode === 'own') return entry.value;
    // declared-inherit → follow `from`/default; undeclared → implicit inherit from the default
    const parent = entry?.from || (id === defaultProfileId ? null : defaultProfileId);
    if (!parent || parent === id) return undefined;
    id = parent;
  }
  return undefined;   // cycle or dead-end
}

/**
 * Resolve every effective property for a profile — the union of its own declared keys and the
 * default profile's keys (the ones it implicitly inherits), each resolved through the chain.
 */
export function effectiveProperties(getProfile, profileId, opts = {}) {
  const { defaultProfileId = null } = opts;
  const self = getProfile(profileId);
  const dflt = (defaultProfileId && defaultProfileId !== profileId) ? getProfile(defaultProfileId) : null;
  const keys = new Set([
    ...(self?.properties ? Object.keys(self.properties) : []),
    ...(dflt?.properties ? Object.keys(dflt.properties) : []),
  ]);
  const out = {};
  for (const key of keys) {
    const v = resolveProperty(getProfile, profileId, key, opts);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Flip a property to OWN (re-scope, no migration). Returns a NEW frozen properties map. */
export function setOwn(properties, key, value) {
  return normaliseProperties({ ...(properties || {}), [key]: { mode: 'own', value } });
}

/** Flip a property to INHERIT (`from` optional → the default profile). Returns a NEW frozen map. */
export function setInherit(properties, key, from) {
  return normaliseProperties({ ...(properties || {}), [key]: inherit(from) });
}

/**
 * personaView — the pure read-model behind the "About me" persona surface
 * (personas #1).  Turns a `getPersonaView` reply (a persona's own/inherit
 * properties + its per-context disclosure policy) plus the user's circle list
 * into a render-ready model that the web AND mobile shells project identically
 * (invariant #1: logic lives once, in shared code; invariant #2: web ≡ mobile
 * by construction from ONE source).
 *
 * The privacy framing is baked into the MODEL, not the shells: sharing is
 * OPT-IN (default WITHHOLD).  A disclosure row is `enabled` only when the
 * persisted policy explicitly enabled it; every other property in every circle
 * reads as withheld.  `sharedKeys` reports what a circle would ACTUALLY see —
 * a property is only shared when it is both toggled on AND has a value — so the
 * shells can show an honest "in this circle you share: …" line with no
 * dark-pattern gap between the toggle and the effect.
 *
 * The editable value vocabulary is the coarse `@onderling/attribute-charter`
 * (buckets → a button picker; `place` is open-coarse → a free-text field).  The
 * charter is the ONLY source of keys, so a shell can never offer to set a finer
 * value than the charter permits.
 *
 * Pure — zero DOM, zero RN, no transport.  The shells own only the widgets +
 * the op calls (`setProfileProperty` / `setProfileDisclosure`); this module
 * owns the shape.
 */

import { attributeKeys, bucketsFor } from '@onderling/attribute-charter';
import { isDriverValue, deriveCategory, SKILLS_TAXONOMY, AVAILABILITY_STATES, availabilityState } from '@onderling/agent-registry';

/* ── availability — the ONE unified reachability property (decision Q5) ───────
 * Not a charter key: a person-level coarse-enum (open/limited/away) that folds
 * the old per-skill availability sub-field AND the holidayMode boolean. Rendered
 * as a normal property ROW in the general-persona section; disclosure-controlled
 * per circle like every other key. The `l10n` prefix tells the shells to localise
 * the value + the bucket options (charter buckets stay raw domain tokens). Its
 * DISPLAY ladder hint is `state → ∅` — the descriptor's finer 'detail' rung
 * (free-text "when") is a TODO, so it isn't offered to users yet. */
export const AVAILABILITY_KEY = 'availability';
const AVAILABILITY_DISPLAY_LADDER = Object.freeze(['state', 'none']);
const AVAILABILITY_L10N = 'circle.mij.availability';

/* ── Ladder labels (Mij → persona's) ─────────────────────────────────────────
 * Rung KEYS per charter attribute, shown finest→coarsest ending in the empty
 * rung ('none' → "∅"). The shells translate each rung via
 * t('circle.mij.rung.<rung>') so the labels localise like everything else.
 *
 * TODO(vocabulary): source these from a registered `propertyVocabulary`
 * (createVocabulary + descriptors) once the base descriptors for the charter
 * attributes land in @onderling/agent-registry — today no concrete ladder
 * descriptors are registered anywhere reachable from the basis app, so this is
 * a static label map (labels only; the coarsen() semantics stay server of the
 * disclosure layer).
 */
export const PROPERTY_LADDERS = Object.freeze({
  place:     Object.freeze(['district', 'municipality', 'region', 'none']),
  ageBand:   Object.freeze(['band', 'adult', 'none']),
  role:      Object.freeze(['category', 'none']),
  tenure:    Object.freeze(['band', 'none']),
  household: Object.freeze(['category', 'none']),
});

/** A driver/skill has NO coarseness ladder — it is shared whole or not at all. */
export const DRIVER_LADDER = Object.freeze(['all', 'none']);

/** The ladder rung keys for a charter attribute, or null when none is known. */
export function ladderFor(key) { return PROPERTY_LADDERS[key] ?? null; }

/* ── own / inherit resolution ────────────────────────────────────────────────
 * The registry stores a profile's properties as MODE ENTRIES:
 *   { mode:'own', value } | { mode:'inherit', from? }
 * (packages/agent-registry/src/profileProperties.js). An undeclared key
 * IMPLICITLY inherits from the default profile. Older fixtures / the standalone
 * agents app hand PLAIN values — both shapes are accepted everywhere here.
 */
function isModeEntry(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && (v.mode === 'own' || v.mode === 'inherit');
}

/** The plain value a raw entry holds itself (own or plain), else undefined. */
function ownValueOf(entry) {
  if (entry === undefined || entry === null) return undefined;
  if (isModeEntry(entry)) return entry.mode === 'own' ? entry.value : undefined;
  return entry;
}

/**
 * Unwrap a raw (possibly mode-shaped) properties map to the profile's OWN plain
 * values. Declared-inherit entries are dropped — a single-profile view can't
 * resolve them; buildMijViewModel (which holds the default profile too) can.
 */
export function unwrapOwnProperties(raw) {
  const out = {};
  for (const [key, entry] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const v = ownValueOf(entry);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/**
 * The own/inherit/absent STATE of `key` on a persona, resolved against the
 * default (root/general) persona's raw map:
 *   • 'own'     — the persona holds its own value (an override),
 *   • 'inherit' — declared OR implicit inherit, and the default resolves a value,
 *   • 'absent'  — nothing resolves anywhere (∅).
 */
export function propertyStateFor(rawSelf, rawDefault, key) {
  const entry = (rawSelf && typeof rawSelf === 'object') ? rawSelf[key] : undefined;
  const ownV = ownValueOf(entry);
  if (ownV !== undefined) return { state: 'own', value: ownV };
  const dfltV = ownValueOf((rawDefault && typeof rawDefault === 'object') ? rawDefault[key] : undefined);
  if (dfltV !== undefined) return { state: 'inherit', value: dfltV };
  return { state: 'absent', value: undefined };
}

/** A render-ready display string for an opaque property value (driver → its text). */
function displayValue(v) {
  if (v === undefined || v === null) return null;
  if (isDriverValue(v)) return v.text || v.tags.join(', ');
  if (typeof v === 'string') return v.length ? v : null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/** The driver-shaped entries of a raw properties map, unwrapped: [{key, kind, text, tags}].
 *  Skill-kind entries also carry `categoryId` — the taxonomy bucket the skill
 *  coarsens to under disclosure (a user-picked id wins over derivation). */
function driverEntries(raw) {
  return Object.entries(unwrapOwnProperties(raw))
    .filter(([, v]) => isDriverValue(v))
    .map(([key, v]) => {
      const entry = { key, kind: v.kind, text: v.text, tags: [...v.tags] };
      if (v.kind === 'skill') {
        entry.categoryId = v.categoryId || deriveCategory({ text: v.text, tags: v.tags });
        const cat = entry.categoryId
          ? SKILLS_TAXONOMY.categories.find((c) => c.id === entry.categoryId)
          : null;
        if (cat) entry.categoryLabel = { ...cat.label }; // {nl, en} — renderer picks by lang
      }
      return entry;
    });
}

/**
 * @param {object} args
 * @param {object} [args.view]     the `getPersonaView` reply
 *   `{ ok, id, properties: {key:value}, disclosure: {perContext:{ctxId:{key:{enabled,rung}}}} }`
 * @param {Array<{id:string,name?:string}>} [args.circles]  the user's circles (id + display name)
 * @returns {{
 *   ok: boolean,
 *   id: string|null,
 *   reason: string|null,
 *   properties: Array<{key:string, value:(string|null), buckets:(string[]|null), free:boolean, set:boolean}>,
 *   circles: Array<{
 *     circleId: string,
 *     name: string,
 *     rows: Array<{key:string, value:string, enabled:boolean, rung:(string|null)}>,
 *     sharedKeys: string[],
 *   }>,
 * }}
 */
export function buildPersonaViewModel({ view, circles } = {}) {
  const ok = view?.ok === true;
  const id = typeof view?.id === 'string' ? view.id : null;
  // The live registry hands MODE entries ({mode:'own',value}); older fixtures hand
  // plain values. Unwrap to plain own values so both shapes render identically.
  const props = unwrapOwnProperties((view && typeof view.properties === 'object' && view.properties) ? view.properties : {});
  const perContext = (view?.disclosure && typeof view.disclosure.perContext === 'object' && view.disclosure.perContext)
    ? view.disclosure.perContext
    : {};
  const circleList = Array.isArray(circles) ? circles : [];

  // The property picker rows — EVERY charter attribute, with the persona's
  // current coarse value (or null when unset). `place` is open-coarse (buckets
  // null → a free-text field); the enum attributes render as a button picker.
  const properties = attributeKeys().map((key) => {
    const buckets = bucketsFor(key) ?? null;   // bucketsFor → undefined for a non-key; null for place — normalise both to null
    const raw = props[key];
    const value = (typeof raw === 'string' && raw.length > 0) ? raw : null;
    return { key, value, buckets, free: buckets == null, set: value != null };
  });

  // Per-circle disclosure. A property is only OFFERABLE for sharing once it has
  // a value (you can't meaningfully share an unset property), so the toggle
  // rows are the keys the persona actually holds. Default WITHHOLD: `enabled`
  // is true only when the persisted policy says so.
  // Personal DRIVERS (#5) — the open `driver`-typed properties, kept separate from the coarse charter
  // attributes above (different value shape: { kind, text, tags[] }, edited with a different widget).
  const drivers = Object.entries(props)
    .filter(([, v]) => isDriverValue(v))
    .map(([key, v]) => ({ key, kind: v.kind, text: v.text, tags: [...v.tags] }));

  const valuedKeys = properties.filter((p) => p.set);
  const circleModels = circleList
    .filter((c) => c && typeof c.id === 'string' && c.id)
    .map((c) => {
      const policy = (perContext[c.id] && typeof perContext[c.id] === 'object') ? perContext[c.id] : {};
      const rows = valuedKeys.map((p) => {
        const entry = (policy[p.key] && typeof policy[p.key] === 'object') ? policy[p.key] : {};
        return {
          key: p.key,
          value: p.value,
          enabled: entry.enabled === true,
          rung: (typeof entry.rung === 'string' && entry.rung) ? entry.rung : null,
        };
      });
      return {
        circleId: c.id,
        name: (typeof c.name === 'string' && c.name) ? c.name : c.id,
        rows,
        // What the circle would ACTUALLY see: toggled on AND has a value.
        sharedKeys: rows.filter((r) => r.enabled && r.value != null).map((r) => r.key),
      };
    });

  return {
    ok,
    id,
    reason: (typeof view?.reason === 'string' && view.reason) ? view.reason : null,
    properties,
    drivers,
    circles: circleModels,
  };
}

/* ── Mij → persona's (the bulletin surface) ─────────────────────────────────
 * The read-model behind the three stacked sections:
 *   1. the GENERAL persona (the default profile — the truth layer): its charter
 *      properties with ladder hints + its skills/drivers as chips,
 *   2. every persona as a card — per key own ("EIGEN") / inherit ("volgt
 *      algemeen") / absent (∅) against the general persona,
 *   3. per circle: who sees what — persona × key × rung × released value, plus
 *      the circle's charter requests when the host has them.
 * Pure — zero DOM; web + mobile project this one model (invariants #1/#2).
 */

/** Normalise a circle's charter (when the host has one) to {requests:[{key,maxRung,purpose}]}. */
function normaliseCharter(charter) {
  const items = Array.isArray(charter?.requests) ? charter.requests : null;
  if (!items || !items.length) return null;
  const requests = items
    .map((r) => ({
      key:     (typeof r?.key === 'string' && r.key) ? r.key : (typeof r?.property === 'string' ? r.property : null),
      maxRung: (typeof r?.maxRung === 'string' && r.maxRung) ? r.maxRung : null,
      purpose: (typeof r?.purpose === 'string' && r.purpose) ? r.purpose : null,
    }))
    .filter((r) => r.key);
  return requests.length ? { requests } : null;
}

/**
 * @param {object} args
 * @param {Array<{id:string, name?:string, properties?:object, disclosure?:object}>} [args.personas]
 *   every profile-role registry entry, RAW ({mode:'own'|'inherit'} maps accepted; plain values too)
 * @param {string} [args.defaultId='default']  the root/general persona's profile id
 * @param {Array<{id:string, name?:string, charter?:object}>} [args.circles]
 * @param {Record<string, Record<string, Record<string, any>>>} [args.releases]
 *   personaId → circleId → the getPersonaRelease `released` map
 */
export function buildMijViewModel({ personas, defaultId = 'default', circles, releases } = {}) {
  const list = (Array.isArray(personas) ? personas : []).filter((p) => p && typeof p.id === 'string' && p.id);
  const dflt = list.find((p) => p.id === defaultId) ?? null;
  const defaultRaw = dflt?.properties ?? {};
  const rel = (releases && typeof releases === 'object') ? releases : {};

  // ── 1 · the general persona (truth layer) ────────────────────────────────
  const generalProperties = attributeKeys().map((key) => {
    const buckets = bucketsFor(key) ?? null;
    const value = displayValue(ownValueOf(defaultRaw[key]));
    return { key, value, buckets, free: buckets == null, set: value != null, ladder: ladderFor(key) };
  });
  // availability — the unified reachability property (decision Q5): a coarse-enum row
  // with a LOCALISED value set (l10n prefix), rendered like place/ageBand.
  const availabilityValue = availabilityState(ownValueOf(defaultRaw[AVAILABILITY_KEY]));
  generalProperties.push({
    key: AVAILABILITY_KEY,
    value: availabilityValue,
    buckets: [...AVAILABILITY_STATES],
    free: false,
    set: availabilityValue != null,
    ladder: AVAILABILITY_DISPLAY_LADDER,
    l10n: AVAILABILITY_L10N,
  });
  const generalDrivers = driverEntries(defaultRaw).map((d) => ({ ...d, ladder: DRIVER_LADDER }));

  // ── 2 · persona cards ────────────────────────────────────────────────────
  // Row keys = the charter attributes + every extra key any persona declares
  // (drivers/skills included), so an override never disappears from its card.
  const keyOrder = [...attributeKeys()];
  for (const p of list) {
    for (const k of Object.keys(p.properties ?? {})) if (!keyOrder.includes(k)) keyOrder.push(k);
  }
  const personaCards = list.map((p) => {
    const isDefault = p.id === defaultId;
    const entries = keyOrder.map((key) => {
      const { state, value } = isDefault
        ? propertyStateFor(p.properties ?? {}, null, key)      // the root inherits from nobody
        : propertyStateFor(p.properties ?? {}, defaultRaw, key);
      return { key, state, value: displayValue(value) };
    });
    return { id: p.id, name: (typeof p.name === 'string' && p.name) ? p.name : p.id, isDefault, entries };
  });

  // ── 3 · per circle: who sees what ────────────────────────────────────────
  const generalShareable = [
    ...generalProperties.filter((gp) => gp.set).map((gp) => gp.key),
    ...generalDrivers.map((d) => d.key),
  ];
  const circleRows = (Array.isArray(circles) ? circles : [])
    .filter((c) => c && typeof c.id === 'string' && c.id)
    .map((c) => {
      const rows = [];
      for (const p of list) {
        const policy = p.disclosure?.perContext?.[c.id];
        if (!policy || typeof policy !== 'object') continue;
        const released = rel[p.id]?.[c.id] ?? null;
        for (const [key, entry] of Object.entries(policy)) {
          if (entry?.enabled !== true) continue;
          rows.push({
            personaId:   p.id,
            personaName: (typeof p.name === 'string' && p.name) ? p.name : p.id,
            key,
            rung: (typeof entry.rung === 'string' && entry.rung) ? entry.rung : null,
            released: (released && released[key] !== undefined) ? displayValue(released[key]) : null,
          });
        }
      }
      // Dashed add-affordance data: general-persona keys with a value that the
      // GENERAL persona doesn't share here yet (opt-UP, default withhold).
      const defaultEnabled = new Set(rows.filter((r) => r.personaId === defaultId).map((r) => r.key));
      const addable = generalShareable.filter((k) => !defaultEnabled.has(k));
      return {
        circleId: c.id,
        name: (typeof c.name === 'string' && c.name) ? c.name : c.id,
        rows,
        addable,
        charter: normaliseCharter(c.charter),
      };
    });

  return {
    ok: !!dflt,
    defaultId: dflt?.id ?? null,
    general: { id: dflt?.id ?? null, name: dflt?.name ?? dflt?.id ?? null, properties: generalProperties, drivers: generalDrivers },
    personas: personaCards,
    circles: circleRows,
  };
}

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
import { isDriverValue } from '@onderling/agent-registry';

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
  const props = (view && typeof view.properties === 'object' && view.properties) ? view.properties : {};
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

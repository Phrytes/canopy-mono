/**
 * embedResolve — resolve a cross-object embed ref to a LIVE title.
 *
 * `embedChips.js` surfaces the reference; this upgrades it from a bare ref to
 * the referenced item's actual title (so a stoop post embedding a task shows
 * "Fix the gate", not "urn:dec:item:T2"). Best-effort + graceful: any failure
 * (unknown type, cross-pod ref, missing crew, not found) leaves the embed
 * unchanged so the chip keeps its label/ref. PURE + shared web↔mobile (callSkill
 * injected).
 *
 * Today resolves the two types with a reliable local snapshot op:
 *   task           → tasks-v0 getTaskSnapshot (needs crewId = the circle id)
 *   calendar-event → calendar  getEventSnapshot
 * Cross-pod (http) refs + stoop/folio types are a follow-up (the Tasks
 * `getItemTree` cross-pod path) — see REMAINING-WORK "Surface embeds[]".
 */

/** type → { app, op } for the snapshot lookup. */
const RESOLVERS = Object.freeze({
  'task':           { app: 'tasks-v0', op: 'getTaskSnapshot' },
  'calendar-event': { app: 'calendar',  op: 'getEventSnapshot' },
});

/** Last local id segment of a ref (urn:dec:item:T2 → T2 · …/items/X.json → X). */
function localId(ref) {
  const s = String(ref ?? '');
  const seg = s.split('/').pop() || s;
  return seg.replace(/\.json$/i, '').split(':').pop() || seg;
}

/**
 * Resolve one embed to its live title, or null when unresolvable.
 * @param {object} a
 * @param {(app:string, op:string, args:object)=>Promise<any>} a.callSkill
 * @param {{type:string, ref:string}} a.embed
 * @param {string} [a.crewId]  the circle id (needed for task snapshots)
 * @returns {Promise<string|null>}
 */
export async function resolveEmbedTitle({ callSkill, embed, crewId } = {}) {
  if (typeof callSkill !== 'function' || !embed || !embed.type || !embed.ref) return null;
  const r = RESOLVERS[embed.type];
  if (!r) return null;
  if (/^https?:\/\//i.test(String(embed.ref))) return null;   // cross-pod → follow-up
  // Try the ref verbatim, then its local-id tail (refs come in both shapes).
  for (const id of [String(embed.ref), localId(embed.ref)]) {
    try {
      const snap = await callSkill(r.app, r.op, { id, ...(crewId ? { crewId } : {}) });
      if (snap && !snap.error) {
        const title = snap.title ?? snap.label ?? null;
        if (title) return String(title);
      }
    } catch { /* try the next id form, else fall through to null */ }
  }
  return null;
}

/**
 * Return a copy of `embeds` with a resolved `title` attached where possible.
 * Unresolved embeds pass through unchanged. Resolves concurrently.
 * @returns {Promise<object[]>}
 */
export async function enrichEmbedsWithTitles({ callSkill, embeds, crewId } = {}) {
  if (!Array.isArray(embeds) || embeds.length === 0) return Array.isArray(embeds) ? embeds : [];
  return Promise.all(embeds.map(async (e) => {
    const title = await resolveEmbedTitle({ callSkill, embed: e, crewId });
    return title ? { ...e, title } : e;
  }));
}

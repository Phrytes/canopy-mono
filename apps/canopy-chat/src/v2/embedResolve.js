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
 * Cross-pod (http) refs resolve by fetching the public item URL and extracting
 * its title (fetch is injected — pure + SSR/test-safe). Stoop/folio TYPES that
 * are still local-only are a follow-up — see REMAINING-WORK "Surface embeds[]".
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

/** First non-empty string among the given candidates, else null. */
function firstNonEmpty(...cands) {
  for (const c of cands) {
    if (typeof c === 'string' && c.trim()) return c;
  }
  return null;
}

/**
 * Extract a display title from a fetched canonical item body (cross-pod JSON).
 * Priority: .text · .title · .name · .label · .source.text · .source.title ·
 * .frontmatter.title (folio notes). Returns the first non-empty string or null.
 */
function titleFromItemBody(body) {
  if (!body || typeof body !== 'object') return null;
  const src = (body.source && typeof body.source === 'object') ? body.source : {};
  const fm = (body.frontmatter && typeof body.frontmatter === 'object') ? body.frontmatter : {};
  return firstNonEmpty(
    body.text, body.title, body.name, body.label,
    src.text, src.title,
    fm.title,
  );
}

/**
 * Resolve a public cross-pod HTTP ref to a title by fetching its JSON body.
 * Best-effort + graceful: any non-ok response or throw → null (the chip keeps
 * its ref). NOTE: a PERMISSION_DENIED (401/403 ACP-protected) placeholder (🔒)
 * is DEFERRED to a follow-up; today such refs resolve to null like any miss.
 * @returns {Promise<string|null>}
 */
async function resolveCrossPodTitle(ref, fetchImpl) {
  if (typeof fetchImpl !== 'function') return null;   // no fetch available → skip, never throw
  try {
    const res = await fetchImpl(ref, { headers: { Accept: 'application/json' } });
    if (!res || !res.ok) return null;                 // 401/403 ACP, 404, … → 🔒 placeholder deferred
    const body = await res.json();
    return titleFromItemBody(body);
  } catch { /* network error / bad JSON → graceful null */ return null; }
}

/**
 * Resolve one embed to its live title, or null when unresolvable.
 * @param {object} a
 * @param {(app:string, op:string, args:object)=>Promise<any>} a.callSkill
 * @param {{type:string, ref:string}} a.embed
 * @param {string} [a.crewId]  the circle id (needed for task snapshots)
 * @param {(url:string, init?:object)=>Promise<any>} [a.fetchImpl]  injected fetch (defaults to globalThis.fetch)
 * @returns {Promise<string|null>}
 */
export async function resolveEmbedTitle({ callSkill, embed, crewId, fetchImpl = globalThis.fetch } = {}) {
  if (!embed || !embed.type || !embed.ref) return null;
  // Cross-pod (public HTTP) refs resolve by fetching the item, regardless of type.
  if (/^https?:\/\//i.test(String(embed.ref))) {
    return resolveCrossPodTitle(String(embed.ref), fetchImpl);
  }
  if (typeof callSkill !== 'function') return null;
  const r = RESOLVERS[embed.type];
  if (!r) return null;
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
export async function enrichEmbedsWithTitles({ callSkill, embeds, crewId, fetchImpl = globalThis.fetch } = {}) {
  if (!Array.isArray(embeds) || embeds.length === 0) return Array.isArray(embeds) ? embeds : [];
  return Promise.all(embeds.map(async (e) => {
    const title = await resolveEmbedTitle({ callSkill, embed: e, crewId, fetchImpl });
    return title ? { ...e, title } : e;
  }));
}

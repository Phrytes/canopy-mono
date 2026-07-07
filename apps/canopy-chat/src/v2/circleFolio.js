/**
 * canopy-chat v2 — circle-scoped Folio file browser (shared, board 10B).
 *
 * Folio leads a double life: private notes (as-is) AND a drive-like view
 * onto a circle's shared pod.  This module is the drive lens — given a
 * flat file list (e.g. from `listFiles`) and an active `circleId`, it
 * scopes the list to that circle (reusing `scopeItems`/`itemCircleId` —
 * circleId ≡ crewId ≡ groupId, plus `circle:ID` / `crew:ID` shorthand),
 * normalizes each entry, and returns rows newest-first.  Pure: the host
 * does the fetching; web + mobile share this and the renderers stay thin.
 */
import { scopeItems, itemCircleId } from './circleScope.js';
// B · Slice 4 — the SAME per-capability treatment lookup the list surface's
// row buttons run through (via replyEmbeds → embedButtonsForReply). Reused
// here so the folio file-OPEN row inherits identical greying/hiding.
import { affordanceTreatment } from '@canopy/app-manifest';

/**
 * B · Slice 4 — capability treatment for the folio file-OPEN row action.
 *
 * The drive browser's ONLY per-file row-action is "open the file": the file
 * row is a button whose click fires `onOpen`. Opening = reading a single file
 * by id → the `get` atom on noun 'file' (a member capability declared in
 * folio's manifest `nouns.file.atoms`). This runs that (get × file) through
 * the EXACT same `affordanceTreatment(capabilityMatrix, …)` lookup the list
 * surface uses for its row buttons — so folio's file row is no longer the one
 * hand-built surface that skips the gate.
 *
 * Returns 'show' | 'grey' | 'hide' ('limit' collapses to 'grey' — a file row
 * is either openable or not). NOTE (honest caveat): every file row shares the
 * same (get × file) capability, so the treatment is UNIFORM — a denied member
 * has EVERY file row greyed, and a 'hidden' consequence omits every file row.
 * Because this surface's row is BOTH the file listing and the open affordance,
 * a 'hidden' get×file therefore also removes the file NAME from view (that name
 * is nominally the separately-gated `list` capability). A GRANTED member is
 * unaffected — returns 'show', so the row behaves exactly as before.
 *
 * The OTHER folio file ops (deleteFromPod/deleteLocally → remove, downloadFile
 * → list, saveToMyPod → add, verifyPodState → get, forceRepush/syncOnce/watch*
 * → domain sync/watch) are NOT rendered as row buttons on this drive surface —
 * they live on the chat/list surface where `embedButtonsForReply` already gates
 * them. So there is nothing else to gate here.
 *
 * @param {object} [opts]
 * @param {Array}  [opts.capabilityMatrix=[]]  the member's built matrix (Slice 4)
 * @param {string} [opts.appOrigin='folio']
 * @returns {'show'|'grey'|'hide'}
 */
export function folioFileOpenTreatment({ capabilityMatrix = [], appOrigin = 'folio' } = {}) {
  const treatment = affordanceTreatment(capabilityMatrix, { app: appOrigin, atom: 'get', noun: 'file' });
  return treatment === 'hide' ? 'hide' : treatment === 'show' ? 'show' : 'grey';
}

/**
 * Normalize a raw Folio file into a stable row shape.  Tolerant of
 * missing fields: `name` falls back to `id`, `kind` defaults to 'file',
 * sizes/timestamps that aren't numbers become null/0.
 *
 * @param {object} raw
 * @returns {{ id, name, kind, size, updatedAt }}
 */
export function normalizeFolioFile(raw = {}) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const id = f.id ?? f.fileId ?? f.path ?? f.name ?? null;
  return {
    id,
    name:      f.name ?? f.title ?? id ?? null,
    kind:      f.kind ?? f.type ?? 'file',
    size:      typeof f.size === 'number' ? f.size : null,
    updatedAt: typeof f.updatedAt === 'number' ? f.updatedAt
             : typeof f.modifiedAt === 'number' ? f.modifiedAt
             : 0,
  };
}

/**
 * Scope a file list to a circle and normalize it into browser rows,
 * newest-first.  Files tagged to the active circle (or carrying no circle
 * hint at all) are kept; files clearly tagged to a *different* circle are
 * dropped.  A null/empty `circleId` keeps everything.  Pure — no fetching.
 *
 * @param {object}   [opts]
 * @param {object[]} [opts.files=[]]      raw Folio files
 * @param {?string}  [opts.circleId=null] active circle (null = unscoped)
 * @returns {{ id, name, kind, size, updatedAt }[]}
 */
export function buildCircleFiles({ files = [], circleId = null } = {}) {
  const list = (files || []).filter((f) => f && typeof f === 'object');
  // Keep files matching the circle + files with no circle hint; drop files
  // clearly tagged to a different circle.
  const scoped = circleId
    ? list.filter((f) => {
        const id = itemCircleId(f);
        return id == null || id === circleId;
      })
    : scopeItems(list, circleId);
  return scoped
    .map(normalizeFolioFile)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Build circle file rows straight from a `listFiles` op result (F-5.2).
 * The op returns `{ items: [...] }` (the in-process index); older shapes use
 * `{ files }` or a bare array. Extract the list, then scope to the circle.
 */
export function circleFilesFromListFiles(result, circleId = null) {
  const files = result && typeof result === 'object'
    ? (Array.isArray(result.items) ? result.items
      : Array.isArray(result.files) ? result.files
        : Array.isArray(result) ? result : [])
    : [];
  return buildCircleFiles({ files, circleId });
}

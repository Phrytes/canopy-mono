/**
 * versionRows — pure view-model mapper for VersionsScreen.
 *
 * Kept JSX-free in src/lib/ (folio-mobile convention: screens are
 * `.js`+JSX and never imported by tests; their logic lives in a pure
 * lib module that IS unit-tested).
 */

/**
 * engine.versions() output → display rows, newest first. Tolerates a
 * non-array / missing input (→ []); drops entries without a finite ts.
 *
 * the store returns opaque records `{ts, id, sha256, size}` — the
 * legacy cosmetic `path` is gone (snapshots are no longer browsable files).
 *
 * @param {Array<{ts:number,id?:string,sha256?:string,size?:number}>} list
 * @returns {Array<{ts:number,size:number,sha8:string}>}
 */
export function toVersionRows(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((v) => v && Number.isFinite(v.ts))
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .map((v) => ({
      ts:   v.ts,
      size: Number.isFinite(v.size) ? v.size : 0,
      sha8: typeof v.sha256 === 'string' ? v.sha256.slice(0, 8) : '',
    }));
}

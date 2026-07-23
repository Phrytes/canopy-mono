/**
 * pathScope — the one prefix-strict "path at-or-below" coverage rule.
 *
 * This is the pure logic behind `PodCapabilityToken.matchesScope`'s PATH half
 * (action matching stays in that class). It is extracted here so a SECOND caller
 * — the per-resource key broker's list/container grain (`res.read:/list/<id>/`)
 * in `@onderling/pod-client` — can reuse the SAME coverage rule instead of
 * re-deriving it. One rule, one place; both token models meet here.
 *
 * Prefix-strict semantics (per Design-v3/pod-client-api.md §PodCapabilityToken):
 *   - A granted path ending in '/' is a CONTAINER scope: it covers any required
 *     path that begins with it. `/notes/` covers `/notes/foo.md` and
 *     `/notes/sub/x.md`, but NOT `/photos/` and NOT `/notesX/foo.md` (the trailing
 *     slash makes the boundary strict — `/notesX/...` does not start with `/notes/`).
 *   - A granted path WITHOUT a trailing '/' is a RESOURCE scope: exact match only.
 *     `/notes/foo.md` covers `/notes/foo.md` and nothing else.
 */

/**
 * Does the granted path cover the required path under prefix-strict rules?
 * @param {string} grantedPath   — path from a granted scope
 * @param {string} requiredPath  — path a request needs covered
 * @returns {boolean}
 */
export function pathScopeCovers(grantedPath, requiredPath) {
  if (typeof grantedPath !== 'string' || typeof requiredPath !== 'string') return false;
  // Container scope → at-or-below prefix match; the trailing '/' keeps the boundary strict.
  if (grantedPath.endsWith('/')) return requiredPath.startsWith(grantedPath);
  // Resource scope → exact match only.
  return grantedPath === requiredPath;
}

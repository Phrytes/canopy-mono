/**
 * podRootHelpers — small URL-shaping helpers for SignInScreen.  Pure
 * strings in / out so they're easy to unit-test outside React.
 */

/**
 * Suggest a pod-root container based on a WebID URL.  Strips the
 * WebID's path/fragment and appends `/folio/`.  Returns `''` when the
 * input isn't a parsable URL.
 *
 * @param {string} webid
 * @returns {string}
 */
export function suggestPodRoot(webid) {
  if (typeof webid !== 'string' || webid.length === 0) return '';
  try {
    const u = new URL(webid);
    return `${u.origin}/folio/`;
  } catch {
    return '';
  }
}

/**
 * Trim, prepend `https://` when no scheme, append a trailing slash.
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizePodRoot(input) {
  let v = String(input ?? '').trim();
  if (v.length === 0) return v;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  if (!v.endsWith('/')) v = `${v}/`;
  return v;
}

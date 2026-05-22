/**
 * **Platform: web** — composes a Solid OIDC `session.fetch` to read /
 * write resources at the user's pod root.
 *
 * canopy-chat — minimal pod-write helper for v0.7.P2.
 *
 * Pattern: when the user signs in (v0.7.P1), `podAuth.getCurrentSession()`
 * returns `{ webid, isLoggedIn, fetch }` where `fetch` is an
 * authenticated browser-fetch.  This module wraps it to provide
 * `createPodWriter(session)` — a function the calendar (and future
 * apps) call to PUT JSON / iCal / Turtle resources at a stable URL
 * under the user's pod root.
 *
 * Path convention:
 *   - `<pod-root>/canopy/<app>/<resource>` — namespaced under
 *     `canopy/` so canopy-chat-managed pod state doesn't collide
 *     with other Solid apps (folio's existing
 *     `<pod>/<folder-mirror>` paths remain unaffected).
 *
 * v0.7.P2 limitations:
 *   - One-way write only (calendar emits .ics feed to pod).
 *   - No conflict detection / If-Match.
 *   - No parent-container creation (PUT to leaf URL; most Solid
 *     servers auto-create containers).  When servers don't,
 *     v0.7.P2.1 adds explicit container creation via PUT with
 *     ldp:Container link header.
 *
 * Future v0.7.P3:
 *   - Bidirectional via @canopy/pseudo-pod cache-mode + per-URI
 *     mode override.
 */

/**
 * Derive a pod root URL from a webid.  Standard Solid convention:
 *   webid `https://anne.example/profile/card#me`
 *     → pod root `https://anne.example/`
 *
 * @param {string} webid
 * @returns {string} pod root URL (ends with `/`)
 */
export function podRootFromWebid(webid) {
  if (typeof webid !== 'string' || webid === '') {
    throw new TypeError('podRootFromWebid: webid required');
  }
  const url = new URL(webid);
  // Standard Solid heuristic: the pod root is wherever the webid
  // doc's `/profile/...` suffix is rooted.
  //   https://anne.example/profile/card#me
  //     → pod root https://anne.example/
  //   https://solidcommunity.net/anne/profile/card#me
  //     → pod root https://solidcommunity.net/anne/
  //   https://anne.example/  (no /profile in path)
  //     → pod root https://anne.example/
  const profileIdx = url.pathname.indexOf('/profile/');
  if (profileIdx >= 0) {
    const prefix = url.pathname.slice(0, profileIdx);
    return `${url.origin}${prefix}/`;
  }
  return `${url.origin}/`;
}

/**
 * Build a pod-namespaced URL for canopy app state.
 *
 * @param {string} podRoot   from podRootFromWebid()
 * @param {string} app       'calendar' | 'household' | …
 * @param {string} resource  path under the app (e.g. 'feed.ics')
 * @returns {string}         full https URL
 */
export function podUrl(podRoot, app, resource) {
  if (typeof podRoot !== 'string' || podRoot === '') {
    throw new TypeError('podUrl: podRoot required');
  }
  const base = podRoot.endsWith('/') ? podRoot : podRoot + '/';
  const r = String(resource ?? '').replace(/^\/+/, '');
  return `${base}canopy/${app}/${r}`;
}

/**
 * Create a podWriter bound to a signed-in session.
 *
 * @param {{ fetch: typeof fetch, webid: string }} session
 * @returns {{
 *   write: (app: string, resource: string, body: string, contentType: string) => Promise<{ ok: boolean, url: string, status: number }>,
 *   read:  (app: string, resource: string) => Promise<{ ok: boolean, url: string, body: string|null, status: number }>,
 *   urlFor: (app: string, resource: string) => string,
 *   webid: string,
 *   podRoot: string,
 * }}
 */
export function createPodWriter(session) {
  if (!session || typeof session.fetch !== 'function' || typeof session.webid !== 'string') {
    throw new TypeError('createPodWriter: session with {fetch, webid} required');
  }
  const podRoot = podRootFromWebid(session.webid);

  return {
    webid:   session.webid,
    podRoot,
    urlFor:  (app, resource) => podUrl(podRoot, app, resource),
    async write(app, resource, body, contentType = 'application/octet-stream') {
      const url = podUrl(podRoot, app, resource);
      const res = await session.fetch(url, {
        method:  'PUT',
        headers: { 'Content-Type': contentType },
        body,
      });
      return { ok: res.ok, url, status: res.status };
    },
    async read(app, resource) {
      const url = podUrl(podRoot, app, resource);
      try {
        const res = await session.fetch(url);
        if (!res.ok) return { ok: false, url, body: null, status: res.status };
        const body = await res.text();
        return { ok: true, url, body, status: res.status };
      } catch (err) {
        return { ok: false, url, body: null, status: 0, error: err?.message };
      }
    },
  };
}

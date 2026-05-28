/**
 * Mobile NKN-on-pod wrappers for Bundle G3 (#265).
 *
 * Web wires these directly in `apps/canopy-chat/web/main.js:1421-1435`:
 *   - `lookupPeerNknByWebid(webid)` → `discoverPeerNknAddr(session, webid)`
 *   - `publishNknAddrToPod()`       → `publishNknAddr(createPodWriter(session), agent.peer.address)`
 *
 * Both `discoverPeerNknAddr` and `publishNknAddr` (in
 * `apps/canopy-chat/src/web/podStorage.js`) are portable — pure
 * URL/string/`session.fetch` work, no DOM, no Node. Mobile imports
 * them directly via the same relative-path pattern hostOps.js uses
 * for `localBuiltins.js` (Metro doesn't honor package.json
 * "exports" subpaths).
 *
 * What's different from web:
 *   - Web reads the session from `podAuth.getCurrentSession()` which
 *     returns `{webid, fetch}`. Mobile's `buildMobilePodAuth`
 *     intentionally returns ONLY `{webid}` (no `fetch`) because the
 *     bearer-fetch lives on `OidcSessionRN.getAuthenticatedFetch()`.
 *   - These wrappers therefore take the raw `sessionRef` (the
 *     `OidcSessionRN` instance) + `agent` directly, mirroring the
 *     pattern Bundle F P6 (#262) already established for sign-in.
 *
 * Architectural note (canopy-chat-unifier-principle): the pod-helpers
 * stay in `apps/canopy-chat/src/web/podStorage.js`. ONLY the
 * mobile-session adapter logic lives here.
 */
import {
  discoverPeerNknAddr,
  discoverPodRoot,
  createPodWriter,
  publishNknAddr,
} from '../../../canopy-chat/src/web/podStorage.js';

/**
 * Build the `lookupPeerNknByWebid` injection for `createLocalBuiltins`.
 *
 * Resolves the peer's WebID → their pod's `canopy/identity/identity.ttl`
 * → the `canopy:nknAddr` triple. Returns the NKN address (`app.<hex>`)
 * or `null` when any step fails (no session, network error, missing
 * triple, ACL denial).
 *
 * Throws when the user isn't signed in — the slash handler in
 * `localBuiltins.lookupPeer` catches and reports via t('lookup.failed').
 *
 * @param {object}  deps
 * @param {{ current: import('@canopy/oidc-session-rn').OidcSessionRN }} deps.sessionRef
 * @returns {(webid: string) => Promise<string|null>}
 */
export function buildLookupPeerNknByWebid({ sessionRef }) {
  return async (webid) => {
    const session = sessionRef?.current;
    if (!session || !session.isAuthenticated() || !session.webid) {
      throw new Error('Sign in first: /signin');
    }
    const authedFetch = session.getAuthenticatedFetch();
    return discoverPeerNknAddr(
      { fetch: authedFetch, webid: session.webid },
      webid,
    );
  };
}

/**
 * Build the `publishNknAddrToPod` injection for `createLocalBuiltins`.
 *
 * Discovers the user's pod root via `pim:storage`, builds a
 * `podWriter`, and PUTs `<pod>/canopy/identity/identity.ttl` with the
 * agent's current NKN address. Returns the `{ ok, url, status }` shape
 * that `localBuiltins.publishNkn` formats for the user.
 *
 * @param {object}  deps
 * @param {{ current: import('@canopy/oidc-session-rn').OidcSessionRN }} deps.sessionRef
 * @param {{ peer?: { address?: string } }} deps.agent
 * @returns {() => Promise<{ ok: boolean, url?: string, status?: number }>}
 */
export function buildPublishNknAddrToPod({ sessionRef, agent }) {
  return async () => {
    const session = sessionRef?.current;
    if (!session || !session.isAuthenticated() || !session.webid) {
      throw new Error('Sign in first: /signin');
    }
    const addr = agent?.peer?.address;
    if (!addr) {
      throw new Error('NKN not connected yet.  /peer-connect first.');
    }
    const authedFetch = session.getAuthenticatedFetch();
    const sessionShim = { fetch: authedFetch, webid: session.webid };
    const podRoot = await discoverPodRoot(sessionShim).catch(() => null);
    const writer  = createPodWriter(sessionShim, podRoot ? { podRoot } : {});
    return publishNknAddr(writer, addr);
  };
}

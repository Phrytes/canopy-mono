// Mobile feedback activation (parity with web main.js `/feedback <code>`) — turn the RN OidcSessionRN
// into the verify-summary loop's own/central/control pods. Own-pod-first: raw stays on the participant's
// own pod, only the verified summary reaches central. Mirrors web's buildFeedbackVerifyPods call; the
// browser-only getOrCreateRecoveryHash (localStorage + crypto.subtle) gets an RN counterpart here
// (AsyncStorage secret + @noble/hashes sha256; crypto.getRandomValues is polyfilled at app entry).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import { buildFeedbackVerifyPods } from '../../../basis/src/feedback/feedbackPod.js';

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** RN counterpart to feedbackPod.getOrCreateRecoveryHash — the secret never leaves the device, only its hash is sent. */
export async function getOrCreateRecoveryHashRN(storage = AsyncStorage) {
  let secret = await storage.getItem('fp.recovery');
  if (!secret) {
    const rand = new Uint8Array(32);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(rand);
    else for (let i = 0; i < rand.length; i += 1) rand[i] = Math.floor(Math.random() * 256);
    secret = toHex(rand);
    await storage.setItem('fp.recovery', secret);
  }
  return toHex(sha256(new TextEncoder().encode(secret)));
}

/**
 * A fetch that re-authenticates ON 401 and retries ONCE. `getAuthenticatedFetch()` is captured once at
 * activation, so a pod write minutes/hours later can hit an aged-out access token → 401. Re-capturing the
 * authed fetch lets the session mint a fresh token (transparent refresh) and the write succeeds instead of
 * silently failing ("Nothing was kept"). If the refresh itself is dead (fully-expired session), the second
 * 401 propagates unchanged — the participant genuinely needs to log in again. Only retries re-sendable bodies
 * (string / absent) so a one-shot stream body is never double-consumed.
 */
function reauthingFetch(session, initial) {
  let fetchFn = initial;
  return async (url, init) => {
    const res = await fetchFn(url, init);
    if (res.status !== 401) return res;
    const body = init?.body;
    if (body != null && typeof body !== 'string') return res;   // can't safely re-send a stream body
    let fresh;
    try { fresh = session.getAuthenticatedFetch(); } catch { return res; }
    if (typeof fresh !== 'function') return res;
    fetchFn = fresh;                                             // keep the refreshed fetch for later calls
    return fresh(url, init);
  };
}

/** A {fetch, webid} shim from an OidcSessionRN, or null when not logged in (mirrors circleStoresRN). */
export function sessionShim(session) {
  // Rely on getAuthenticatedFetch (transparent refresh on expiry/401) + the presence of a webid — NOT a hard
  // isAuthenticated() gate. isAuthenticated() returns false the moment the (short-lived) access token expires
  // even though a refresh token can renew it, which wrongly reported 'not-logged-in' after the token aged out.
  if (!session || typeof session.getAuthenticatedFetch !== 'function' || !session.webid) return null;
  let fetchFn;
  try { fetchFn = session.getAuthenticatedFetch(); } catch { return null; }
  if (typeof fetchFn !== 'function') return null;
  // Wrap so a 401 (aged-out access token) re-captures the authed fetch (fresh token) and retries once.
  return { fetch: reauthingFetch(session, fetchFn), webid: session.webid };
}

/**
 * Activate mobile feedback → the verify-summary pods. Throws `not-logged-in` when there is no pod session.
 * @returns {Promise<{ownPod, centralPod, controlStore}>}
 */
export async function activateMobileFeedback({ session, activationUrl, projectId, code, storage, fetchImpl, podRef }) {
  const shim = sessionShim(session);
  if (!shim) throw new Error('not-logged-in');
  const recoveryHash = await getOrCreateRecoveryHashRN(storage);
  // the activation POST itself is unauthenticated (the cohort code authorises); the pods use the
  // session's authed fetch. `fetchImpl` defaults to global fetch (prod), injectable for tests.
  // `podRef` (when already activated) skips re-activation — the cohort code is single-use, so re-opening
  // the contact would otherwise fail. Returns podRef so the caller can persist + reuse it.
  return buildFeedbackVerifyPods({ session: shim, activationUrl, projectId, code, recoveryHash, fetchImpl, podRef });
}

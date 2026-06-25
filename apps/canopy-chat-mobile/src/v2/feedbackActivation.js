// Mobile feedback activation (parity with web main.js `/feedback <code>`) — turn the RN OidcSessionRN
// into the verify-summary loop's own/central/control pods. Own-pod-first: raw stays on the participant's
// own pod, only the verified summary reaches central. Mirrors web's buildFeedbackVerifyPods call; the
// browser-only getOrCreateRecoveryHash (localStorage + crypto.subtle) gets an RN counterpart here
// (AsyncStorage secret + @noble/hashes sha256; crypto.getRandomValues is polyfilled at app entry).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import { buildFeedbackVerifyPods } from '../../../canopy-chat/src/feedback/feedbackPod.js';

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

/** A {fetch, webid} shim from an OidcSessionRN, or null when not logged in (mirrors circleStoresRN). */
export function sessionShim(session) {
  if (!session || typeof session.isAuthenticated !== 'function' || !session.isAuthenticated() || !session.webid) return null;
  let fetchFn;
  try { fetchFn = session.getAuthenticatedFetch(); } catch { return null; }
  if (typeof fetchFn !== 'function') return null;
  return { fetch: fetchFn, webid: session.webid };
}

/**
 * Activate mobile feedback → the verify-summary pods. Throws `not-logged-in` when there is no pod session.
 * @returns {Promise<{ownPod, centralPod, controlStore}>}
 */
export async function activateMobileFeedback({ session, activationUrl, projectId, code, storage, fetchImpl }) {
  const shim = sessionShim(session);
  if (!shim) throw new Error('not-logged-in');
  const recoveryHash = await getOrCreateRecoveryHashRN(storage);
  // the activation POST itself is unauthenticated (the cohort code authorises); the pods use the
  // session's authed fetch. `fetchImpl` defaults to global fetch (prod), injectable for tests.
  return buildFeedbackVerifyPods({ session: shim, activationUrl, projectId, code, recoveryHash, fetchImpl });
}

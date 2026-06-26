// Browser-auth wiring (Tier 3c) — turn a logged-in Solid pod session into the participant's
// REAL feedback pod: call the activation service with the participant's WebID + cohort code
// to provision/get their ACP-locked container, then back a CssCentralPod (flat: their own
// container) with the session's authenticated, browser-key fetch. Pre-send: the floor runs
// on-device and the participant writes their OWN container — nothing raw leaves, and the
// write IS the consent.

import { makeCssCentralPod } from '../../../feedback-pipeline/src/pod/css-auth.js';
import { PodRoundControl } from '../../../feedback-pipeline/src/verify/round-control.js';

/** POST the activation service → the participant's container URI (podRef). */
export async function activateParticipant({ activationUrl, projectId, code, recoveryHash, webId, fetchImpl = fetch }) {
  if (!activationUrl || !projectId || !code || !webId) throw new Error('activateParticipant: activationUrl, projectId, code, webId required');
  const res = await fetchImpl(`${activationUrl.replace(/\/$/, '')}/activate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, code, recoveryHash, webId }),
  });
  let json = {};
  try { json = await res.json(); } catch { /* leave {} */ }
  if (!res.ok || !json.ok) throw new Error(json.reason || `activation failed (HTTP ${res.status})`);
  return json.podRef;
}

/** Activate, then build a flat CssCentralPod over the browser session's authenticated fetch. */
export async function buildFeedbackPod({ session, activationUrl, projectId, code, recoveryHash, fetchImpl }) {
  if (!session?.webid || typeof session.fetch !== 'function') throw new Error('buildFeedbackPod: a logged-in session {webid, fetch} is required');
  const podRef = await activateParticipant({ activationUrl, projectId, code, recoveryHash, webId: session.webid, fetchImpl });
  return makeCssCentralPod({ podBase: podRef, authedFetch: session.fetch, flat: true });
}

/** Derive the participant's OWN-pod root from their WebID (CSS: `<root>profile/card#me` → `<root>`). */
export function podRootFromWebId(webId) {
  const u = new URL(webId);
  const path = u.pathname.replace(/profile\/card.*$/, '');     // strip the profile doc + fragment
  return `${u.origin}${path.endsWith('/') ? path : `${path}/`}`;
}

/**
 * Verify-summary loop wiring (own-pod-first) — activate, then return the three things the surface needs
 * from the participant's session. The raw never leaves the participant's own pod; only the verified
 * summary reaches central (proven live in scripts/verify-summary-css.js).
 *   • ownPod      — a container on the participant's OWN pod (raw stays; the central owner has no access)
 *   • centralPod  — the activation-provisioned container (owner-readable; the VERIFIED summary lands here)
 *   • controlStore — the shared `/control/` container (the lead opens rounds; the participant reads them)
 * @returns {Promise<{ownPod, centralPod, controlStore}>}
 */
export async function buildFeedbackVerifyPods({ session, activationUrl, projectId, code, recoveryHash, fetchImpl, ownPodBase } = {}) {
  if (!session?.webid || typeof session.fetch !== 'function') throw new Error('buildFeedbackVerifyPods: a logged-in session {webid, fetch} is required');
  const podRef = await activateParticipant({ activationUrl, projectId, code, recoveryHash, webId: session.webid, fetchImpl });
  const centralPod = await makeCssCentralPod({ podBase: podRef, authedFetch: session.fetch, flat: true });
  const ownBase = ownPodBase || `${podRootFromWebId(session.webid)}feedback-own/`;
  // the own pod is the participant's OWN pod — the activation service can't reach it, so ensure the
  // container exists here with the participant's own session (they own it; idempotent — 2xx OR 409/412).
  await session.fetch(ownBase, { method: 'PUT', headers: { 'content-type': 'text/turtle', link: '<http://www.w3.org/ns/ldp#Container>; rel="type"' } }).catch(() => {});
  const ownPod = await makeCssCentralPod({ podBase: ownBase, authedFetch: session.fetch, flat: true });
  const controlBase = podRef.replace(/[^/]+\/$/, 'control/');   // sibling of the participant's container
  const controlStore = new PodRoundControl({ pod: await makeCssCentralPod({ podBase: controlBase, authedFetch: session.fetch, flat: true }) });
  return { ownPod, centralPod, controlStore };
}

/** A stable client recovery hash kept in localStorage — the secret never leaves the device,
 *  only its hash is sent. Browser-only; Node callers pass recoveryHash directly. */
export async function getOrCreateRecoveryHash(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage || typeof crypto === 'undefined' || !crypto.subtle) throw new Error('recovery hash needs a browser (localStorage + crypto.subtle)');
  let secret = storage.getItem('fp.recovery');
  if (!secret) {
    secret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
    storage.setItem('fp.recovery', secret);
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

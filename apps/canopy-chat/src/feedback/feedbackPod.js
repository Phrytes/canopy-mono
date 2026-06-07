// Browser-auth wiring (Tier 3c) — turn a logged-in Solid pod session into the participant's
// REAL feedback pod: call the activation service with the participant's WebID + cohort code
// to provision/get their ACP-locked container, then back a CssCentralPod (flat: their own
// container) with the session's authenticated, browser-key fetch. Pre-send: the floor runs
// on-device and the participant writes their OWN container — nothing raw leaves, and the
// write IS the consent.

import { makeCssCentralPod } from '../../../feedback-pipeline/src/pod/css-auth.js';

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

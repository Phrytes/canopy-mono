/**
 * canopy-chat-mobile — per-circle pod producers + content-seal strategies (RN parity
 * with web's `circleApp.js` S4 wiring). One producer per circle (sealing identity +
 * control agent over an in-memory pseudo-pod) lives OUTSIDE the single stoop agent;
 * `getCircleSealStrategy` resolves the circle's `{seal,open}` content strategy so
 * `scopeStoopCallSkill` can transparently seal a p2/p3 circle's noticeboard posts.
 *
 * The crypto is now pure-JS (tweetnacl + @noble/hashes — the RNG is polyfilled at app
 * entry via `react-native-get-random-values`), so this runs on Metro. The vault is
 * AsyncStorage-backed and injected via `initCirclePods` (kept off module scope so vitest
 * can import this without an AsyncStorage native module); the group-key resource persists
 * there for durability across reloads.
 */
import { VaultAsyncStorage } from '../../../../packages/react-native/src/identity/VaultAsyncStorage.js';
import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';
import { PodClient, generateKeypair as podGenerateKeypair, SolidOidcAuth } from '@canopy/pod-client';
import { createCirclePodProducer, createCircleControlAgentRouter, seedCircleRoster } from '../../../canopy-chat/src/v2/circlePodProducer.js';
import { realPodRouting } from '../../../canopy-chat/src/v2/circleRealPod.js';
import { createCirclePodSharing } from '../../../canopy-chat/src/v2/circlePodSharing.js';

let circleVault = null;                       // VaultAsyncStorage (durable) — set by initCirclePods
let podSessionRef = null;                     // App-owned OidcSessionRN ref — set by setCirclePodSession
const circlePods = new Map();                 // circleId → producer
const circleSealStrategies = new Map();       // circleId → {seal,open} | null

/** Wire the durable AsyncStorage vault (call once at app boot with the RN AsyncStorage). */
export function initCirclePods(asyncStorage) {
  if (asyncStorage && !circleVault) {
    circleVault = new VaultAsyncStorage({ prefix: 'cc-circle-pod:', asyncStorage });
  }
}

/** Share the App-owned OidcSessionRN (a ref or the session). When signed in, sealed circles
 *  route to the user's REAL pod via the session's authenticated fetch (else the pseudo-pod). */
export function setCirclePodSession(sessionOrRef) { podSessionRef = sessionOrRef; }

/** The signed-in user's AUTHED fetch (OidcSessionRN bearer), or null when signed
 *  out. embed-ref resolution uses it to read the user's OWN private-pod items. */
export function getCirclePodFetch() {
  const s = podSessionRef?.current ?? podSessionRef;
  try {
    if (s && typeof s.isAuthenticated === 'function' && s.isAuthenticated()
        && typeof s.getAuthenticatedFetch === 'function') {
      return s.getAuthenticatedFetch();
    }
  } catch { /* best-effort */ }
  return null;
}

/** Adapt an OidcSessionRN → the {webid, isLoggedIn, fetch} shape realPodRouting expects. */
function sessionShape() {
  const s = podSessionRef?.current ?? podSessionRef;
  if (!s || typeof s.isAuthenticated !== 'function' || !s.isAuthenticated() || !s.webid) return null;
  let fetch;
  try { fetch = s.getAuthenticatedFetch(); } catch { return null; }
  return { webid: s.webid, isLoggedIn: true, fetch };
}

/** The active real-pod routing from the signed-in session (or null → pseudo-pod). */
export function getActiveRealPodRouting() {
  const shaped = sessionShape();
  return shaped ? realPodRouting(shaped, { PodClient, SolidOidcAuth }) : null;
}

/** An in-memory pseudo-pod client for one circle (no OIDC; group key persisted via the vault). */
function makeCirclePodClient(circleId) {
  const deviceId = `circle-${circleId}`;
  const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId });
  return new PodClient({ podRoot: `pseudo-pod://${deviceId}/`, auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
}

/** Ensure a per-circle producer exists (idempotent). Best-effort; null when no vault / on failure. */
export async function ensureCirclePod(circleId, policy) {
  if (!circleId || !circleVault || circlePods.has(circleId)) return circlePods.get(circleId) ?? null;
  let producer = null;
  // Circle OIDC: when signed in, route a sealed circle to the user's REAL pod via the RN
  // session's authenticated fetch (the fetch is no longer hidden); else the pseudo-pod.
  const routing = getActiveRealPodRouting();
  // On a REAL pod, wire a real ACP `sharing` (member redeem → pod read grant) for true
  // multi-device. web parity (circleApp). Pseudo-pod keeps the no-op.
  const shaped = sessionShape();
  const sharing = (routing && shaped)
    ? createCirclePodSharing({ fetch: shaped.fetch, ownerWebId: shaped.webid })
    : undefined;
  try {
    producer = await createCirclePodProducer({
      circleId, storagePosture: policy?.storagePosture ?? 'p0', vault: circleVault,
      generateKeypair: podGenerateKeypair,
      makePodClient: routing ? routing.makePodClient : makeCirclePodClient,
      circleRootUri: routing ? routing.circleRootUri(circleId) : undefined,
      sharing,
    });
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[circlePods] ensureCirclePod failed:', err?.message ?? err);
  }
  circlePods.set(circleId, producer);
  return producer;
}

// S4 — routes stoop membership events (redeem/leave) to the joined circle's producer for
// multi-member sealing (the joiner's sealing key is wrapped into the group key). Pass to
// bootAgentBundle as `stoopControlAgent`. V0: routes to a live (opened) circle's producer.
export const circleControlAgentRouter = createCircleControlAgentRouter((id) => circlePods.get(id) ?? null);

/** Ensure a circle's producer, then seed its group-key roster with prior members (web parity). */
export async function seedCircleRosterFor({ circleId, policy, callSkill }) {
  const prod = await ensureCirclePod(circleId, policy);
  if (!prod?.controlAgent) return 0;
  return seedCircleRoster({ callSkill, circleId, router: circleControlAgentRouter });
}

/** Resolve (+ cache) a circle's content seal/open strategy via the device's own sealing identity. */
export async function getCircleSealStrategy(circleId, policy) {
  if (circleSealStrategies.has(circleId)) return circleSealStrategies.get(circleId);
  let strat = null;
  try {
    const prod = await ensureCirclePod(circleId, policy);
    if (prod?.controlAgent && prod.sealingIdentity) {
      const idKey = await prod.sealingIdentity.ensure();
      strat = await prod.controlAgent.sealingStrategy(idKey.privateKey);
    }
  } catch { strat = null; }
  circleSealStrategies.set(circleId, strat);
  return strat;
}

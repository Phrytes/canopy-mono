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
import { VaultAsyncStorage } from '@canopy/react-native/identity/VaultAsyncStorage';
import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';
import { PodClient, generateKeypair as podGenerateKeypair, SolidOidcAuth,
  createSealedPodDataSource, podGroupPrefix } from '@canopy/pod-client';
import { makeCircleLists } from '@canopy/kring-host/circleLists';
import { createCirclePodProducer, createCircleControlAgentRouter, seedCircleRoster } from '../../../canopy-chat/src/v2/circlePodProducer.js';
import { realPodRouting } from '../../../canopy-chat/src/v2/circleRealPod.js';
import { createCirclePodSharing } from '../../../canopy-chat/src/v2/circlePodSharing.js';
// cluster K · objective L — the SHARED cross-circle SHARE logic + the platform-neutral enforcement assembly.
// Mobile calls the SAME builder + ops as web (circleApp.js) — invariant #1/#2, no mobile fork.
import { buildCircleShareEnforcement } from '../../../canopy-chat/src/v2/circleShareEnforcement.js';
import { shareItemAcrossCircles, listSharedResolved, revokeItemShare } from '../../../canopy-chat/src/v2/circleShare.js';
import { buildHouseholdDataSource } from '../../../household/src/index.js';

let circleVault = null;                       // VaultAsyncStorage (durable) — set by initCirclePods
let podSessionRef = null;                     // App-owned OidcSessionRN ref — set by setCirclePodSession
let asyncStorageRef = null;                   // raw RN AsyncStorage — for the default (non-pod) lists DataSource
const circlePods = new Map();                 // circleId → producer
const circleSealStrategies = new Map();       // circleId → {seal,open} | null

/** Wire the durable AsyncStorage vault (call once at app boot with the RN AsyncStorage). */
export function initCirclePods(asyncStorage) {
  if (asyncStorage) asyncStorageRef = asyncStorage;
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

// ── cluster K · objective L — the cross-circle SHARE composition root (RN mirror of web circleApp.js) ────────
// Web≡mobile by construction: the SHARED share ops (circleShare.js) + the SHARED enforcement assembly
// (circleShareEnforcement.js) are wired here to the mobile pod objects (session/routing/producer). Absent a
// pod session + a sealing strategy the pod path declines (returns null) and the op degrades to the in-memory
// `shared-ref` behaviour — the same additive fallback web uses. No mobile-specific share/seal reimplementation.

// The app-wide DEFAULT lists service, persistent via an AsyncStorage-backed DataSource (in-memory fallback).
// Lazy + memoised. Mirrors web's getDefaultCircleLists (IDB there).
let _defaultListsPromise = null;
function getDefaultCircleLists() {
  if (!_defaultListsPromise) {
    _defaultListsPromise = (async () => {
      let dataSource;
      try {
        // AsyncStorage-backed on device (durable); in-memory when no store is wired (SSR/tests).
        dataSource = asyncStorageRef
          ? await buildHouseholdDataSource({ dbName: 'cc-circle-lists-state', asyncStorage: asyncStorageRef })
          : undefined;
      } catch { dataSource = undefined; }   // no store → in-memory (makeCircleLists' default)
      return makeCircleLists({ dataSource });
    })();
  }
  return _defaultListsPromise;
}

// A SEALED, POD-BACKED lists service per circle (opt-in). Present only when signed in (real-pod routing +
// authed fetch) AND the circle resolves a sealing strategy (p2/p3 with a group key). Absent → null and the
// caller keeps the default lists, so nothing breaks with no pod session (additive). Mirrors web getPodCircleLists.
const _podCircleListsByCircle = new Map();   // circleId → Promise<listsSvc | null>
export async function getPodCircleLists(circleId, policy) {
  const routing = getActiveRealPodRouting();
  const authedFetch = getCirclePodFetch();
  if (!circleId || !authedFetch || !routing?.podRoot) return null;
  if (!_podCircleListsByCircle.has(circleId)) {
    _podCircleListsByCircle.set(circleId, (async () => {
      try {
        const strategy = await getCircleSealStrategy(circleId, policy);
        if (!strategy) return null;   // p0/p1 or no group key → decline rather than write plaintext to the pod
        const dataSource = createSealedPodDataSource({ fetch: authedFetch, podUrl: routing.podRoot, strategy });
        return makeCircleLists({ dataSource, rootPrefix: podGroupPrefix(routing.podRoot) });
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[circlePods] pod-backed lists unavailable:', err?.message ?? err);
        return null;
      }
    })());
  }
  return _podCircleListsByCircle.get(circleId);
}

/** Resolve a circle's lists service: the sealed pod-backed one when available, else the app default. */
export async function getCircleLists(circleId, policy) {
  const pod = await getPodCircleLists(circleId, policy);
  return pod || getDefaultCircleLists();
}

// The POD-TIER enforcement binder for a circle's cross-circle SHARE — built from the SHARED assembly. Returns
// the `{onShare, onShareCanonical, revokeCanonical, policy}` binder when the pod path is ACTIVE (signed-in
// real-pod routing + the pod-client's ACP `sharing` + a resolved seal strategy); else null (memory path).
const _shareEnforcementByCircle = new Map();   // circleId → Promise<enforcement | null>
export async function getCircleShareEnforcement(circleId, policy) {
  if (!circleId) return null;
  const routing = getActiveRealPodRouting();
  const podRoot = routing?.podRoot;
  if (!podRoot) return null;                    // not signed in → memory path
  if (!_shareEnforcementByCircle.has(circleId)) {
    _shareEnforcementByCircle.set(circleId, (async () => {
      try {
        const prod     = await ensureCirclePod(circleId, policy);
        const strategy = await getCircleSealStrategy(circleId, policy);
        const sharing  = prod?.podClient?.sharing;   // client.sharing = { grant, list, revoke } (resourceUri shape)
        let idKey = null;
        try { idKey = prod?.sealingIdentity ? await prod.sealingIdentity.ensure() : null; } catch { idKey = null; }
        // The SAME platform-neutral builder web uses — requires a real ACP sharing + seal strategy, wires the
        // canonical controller from the control agent's group-key resource + this device's sealing identity.
        return buildCircleShareEnforcement({ sharing, strategy, podRoot, controlAgent: prod?.controlAgent, idKey });
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[circlePods] share enforcement unavailable:', err?.message ?? err);
        return null;
      }
    })());
  }
  return _shareEnforcementByCircle.get(circleId);
}

// A best-effort per-circle policy lookup. Mobile has no per-circle admin policy store wired into this module
// yet, so real callers should pass `policyOf` explicitly (the source circle's `sharePosture`/`admins`). The
// default returns {} → normalizeCirclePolicy → 'closed' (deny-by-default). NOTE (follow-up): wire a mobile
// circle-policy store here so the initiator gate reads the live posture without the caller threading it.
const _defaultPolicyOf = async () => ({});

// Build the resolveService / enforcementFor pair for a share op, closing over the effective policy lookup so
// each circle picks its own pod-vs-default lists + enforcement (mirrors web's _circleServiceFor / _shareEnforcementFor).
function _shareResolvers(policyOf) {
  const pol = typeof policyOf === 'function' ? policyOf : _defaultPolicyOf;
  const resolveService = async (id) => getCircleLists(id, await pol(id));
  const enforcementFor = async (id) => {
    try { return await getCircleShareEnforcement(id, await pol(id)); } catch { return null; }
  };
  return { resolveService, enforcementFor, policyOf: pol };
}

/**
 * SHARE one item from `fromCircleId` into `toCircleId`'s audience — the mobile-wired path into the shared
 * `shareItemAcrossCircles`. Canonical posture grants IN PLACE (no copy) via the enforcement's onShareCanonical;
 * the copy postures re-seal via `sealCopy` + `recipientKeys`. Callers may inject `resolveService`/`enforcementFor`
 * (the composition root's own by default) and MUST pass `policyOf` (the source circle's admin policy) for the
 * initiator gate. There is no mobile SHARE UI screen yet — this is the invocable composition-root wiring.
 */
export async function shareItemIntoCircle({
  itemId, fromCircleId, toCircleId, by, recipient, recipients, recipientKeys, sealCopy,
  resolveService, enforcementFor, policyOf,
} = {}) {
  const r = _shareResolvers(policyOf);
  return shareItemAcrossCircles({
    resolveService: resolveService ?? r.resolveService,
    enforcementFor: enforcementFor ?? r.enforcementFor,
    policyOf: r.policyOf,
    recipientKeys, sealCopy,
    itemId, fromCircleId, toCircleId, by, recipient, recipients,
  });
}

/** The READ path: everything shared INTO `circleId`, resolved deny-by-default (a non-recipient's ref is dropped). */
export async function listSharedItems(circleId, { recipient, resolveService, enforcementFor, policyOf } = {}) {
  const r = _shareResolvers(policyOf);
  return listSharedResolved({
    resolveService: resolveService ?? r.resolveService,
    enforcementFor: enforcementFor ?? r.enforcementFor,
    circleId, recipient,
  });
}

/** UN-SHARE (revoke) a recipient's canonical access — rotate the group key + ACP-revoke. `not-canonical` otherwise. */
export async function unshareItemFromCircle({
  itemId, fromCircleId, toCircleId, recipient, recipients, remainingRecipients,
  resolveService, enforcementFor, policyOf,
} = {}) {
  const r = _shareResolvers(policyOf);
  return revokeItemShare({
    resolveService: resolveService ?? r.resolveService,
    enforcementFor: enforcementFor ?? r.enforcementFor,
    policyOf: r.policyOf,
    itemId, fromCircleId, toCircleId, recipient, recipients, remainingRecipients,
  });
}

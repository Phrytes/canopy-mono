/**
 * Community catalog — a CIRCLE-scoped, admin-gated endorsement resource
 * (commons-governance G3, the federation + moderation slice).
 *
 * ── What it is ──────────────────────────────────────────────────────────────
 * G1 shipped a per-endorser shared-readable endorsement resource (authority =
 * the signature). G2 walked MANY such resources as a web-of-trust. G3 adds the
 * "N>1" read of the same construct the plan names: a **community** — which the
 * repo models as a **circle** (`packages/circles/`) — OWNS an endorsement
 * resource whose WRITES are gated to the circle's ADMINS. A community's
 * endorsements are what its subscribers see; joining the community (subscribe,
 * see subscriptions.js) = trusting its curation.
 *
 * ── The gate is the CIRCLE's, not a new authz model (invariant: reuse) ──────
 * This module does NOT invent an admin/policy check. It consumes an INJECTED
 * `isAdmin(endorserPubKey) → boolean` predicate that the caller derives from
 * the circle's OWN roster policy. In basis that predicate is the circles
 * substrate's audience resolver over the circle's admin role, e.g.
 *
 *     import { inAudience } from '@onderling/circles';
 *     const isAdmin = (pk) => inAudience(pk, 'role:admin', { roleMembers: circle.roles });
 *
 * — i.e. exactly the `by ∈ admins` gate `PLAN-circle-share-policy` already uses
 * for share initiation. Keeping the predicate INJECTED (rather than importing
 * `@onderling/circles` here) preserves the substrate layering: `@onderling/agent-
 * registry` stays circle-agnostic; the app wires the concrete circle policy.
 * A non-admin's endorsement is REJECTED (deny-by-default): if no predicate is
 * supplied the catalog refuses to build rather than silently ungating.
 *
 * ── webid ↔ pubKey seam ─────────────────────────────────────────────────────
 * An endorsement's `endorser` is a pubKey; a circle roster stores WebIDs. In
 * basis the local member's WebID IS its pubKey (realAgent registers
 * `{ webid: chatId.pubKey, role: 'admin' }`), so the predicate compares pubKeys
 * directly. On a real multi-member pod a `MemberMap` (identity-resolver) maps
 * WebID↔pubKey; the injected predicate absorbs that mapping without this module
 * changing. // G3-seam: real MemberMap-backed WebID↔pubKey in the predicate.
 *
 * ── Companion-node hosting (deployment seam, NOT built here) ─────────────────
 * The resource is an ordinary pod resource. A community's admin/companion node
 * (R1–R3) CAN host + publish it — the commons literally runs on the companion
 * node. That is a DEPLOYMENT choice (which pod URI backs `pseudoPod`), not code
 * in this module. // G3-seam: companion-node-hosted community resource (R1-R3).
 */

import { createEndorsementResource } from './endorsementResource.js';
import { verifyEndorsement }         from './endorsement.js';

/**
 * Circle-scoped shared-readable resource URI for a community catalog. Distinct
 * from the per-endorser G1 path (`/public/endorsements`) so a device can host
 * both its own endorsements AND a community it admins, keyed by circleId.
 */
export function communityCatalogUri({ circleId, anchorPodUri, deviceId, preferPodUri = false } = {}) {
  if (typeof circleId !== 'string' || circleId.length === 0) {
    throw Object.assign(new Error('communityCatalogUri: circleId is required'), { code: 'INVALID_ARGUMENT' });
  }
  const seg = encodeURIComponent(circleId);
  if (preferPodUri && typeof anchorPodUri === 'string' && anchorPodUri.length > 0) {
    const base = anchorPodUri.endsWith('/') ? anchorPodUri.slice(0, -1) : anchorPodUri;
    return `${base}/public/communities/${seg}/endorsements`;
  }
  if (typeof deviceId === 'string' && deviceId.length > 0) {
    return `pseudo-pod://${deviceId}/public/communities/${seg}/endorsements`;
  }
  if (typeof anchorPodUri === 'string' && anchorPodUri.length > 0) {
    const base = anchorPodUri.endsWith('/') ? anchorPodUri.slice(0, -1) : anchorPodUri;
    return `${base}/public/communities/${seg}/endorsements`;
  }
  throw Object.assign(
    new Error('communityCatalogUri: deviceId (preferred) or anchorPodUri is required'),
    { code: 'INVALID_ARGUMENT' },
  );
}

/**
 * createCommunityCatalog — an admin-gated, circle-owned endorsement resource.
 *
 * Writes (`endorse`, `revoke`, `fork`) are gated to the circle's admins via the
 * injected `isAdmin` predicate; reads (`list`, `get`) are open (the resource is
 * shared-readable, authority = the signature). Built ON TOP of the G1
 * `createEndorsementResource` (etag-CAS append/revoke reused unchanged).
 *
 * @param {object} opts
 * @param {string}   opts.circleId  — the owning circle's id.
 * @param {(endorserPubKey: string) => (boolean|Promise<boolean>)} opts.isAdmin
 *   — the CIRCLE's admin/policy gate (reuse circles' `inAudience('role:admin')`).
 * @param {object}   opts.pseudoPod — injected pod I/O (same as the G1 resource).
 * @param {string}   [opts.anchorPodUri]
 * @param {string}   [opts.deviceId]      — default store path (strongly recommended).
 * @param {boolean}  [opts.preferPodUri]
 * @param {string}   [opts.resourceUri]   — explicit override (wins).
 * @param {number}   [opts.maxRetries]
 * @param {(err: Error) => void} [opts.onPersistentConflict]
 * @param {() => string} [opts.now]
 * @param {(uri: string) => (any|Promise<any>)} [opts.ensureAccess]
 *   — best-effort real-pod access-control hook, forwarded to the underlying
 *   endorsement resource. For a community catalog the app wires it to
 *   `setResourceAccess` with **public-read + owner-write + admin-write** (the
 *   circle's admins' WebIDs — resolve admin pubKeys→WebIDs via the identity
 *   resolver / `AgentRegistryMemberMap`; in basis webid===pubKey today).
 *   Hermetic no-op on the pseudo-pod. // G3-seam: admin WebIDs via MemberMap.
 * @returns {{ endorse, revoke, fork, list, get, ensureAccess, circleId: string, resourceUri: string }}
 */
export function createCommunityCatalog({
  circleId,
  isAdmin,
  pseudoPod,
  anchorPodUri,
  deviceId,
  preferPodUri = false,
  resourceUri,
  maxRetries,
  onPersistentConflict,
  ensureAccess,
  now,
} = {}) {
  if (typeof circleId !== 'string' || circleId.length === 0) {
    throw Object.assign(new Error('createCommunityCatalog: circleId is required'), { code: 'INVALID_ARGUMENT' });
  }
  if (typeof isAdmin !== 'function') {
    // Deny-by-default: a community catalog with NO admin gate would be an open
    // write surface. Refuse to build rather than silently ungate the commons.
    throw Object.assign(
      new Error('createCommunityCatalog: isAdmin(endorserPubKey) gate is required (reuse the circle policy — do not ungate)'),
      { code: 'INVALID_ARGUMENT' },
    );
  }
  const uri = resourceUri ?? communityCatalogUri({ circleId, anchorPodUri, deviceId, preferPodUri });
  const resource = createEndorsementResource({
    pseudoPod, resourceUri: uri, maxRetries, onPersistentConflict,
    ...(typeof ensureAccess === 'function' ? { ensureAccess } : {}),
    ...(typeof now === 'function' ? { now } : {}),
  });

  async function _assertAdmin(pubKey, action) {
    if (typeof pubKey !== 'string' || pubKey.length === 0) {
      throw Object.assign(new Error(`community-catalog: ${action} requires an actor pubKey`), { code: 'INVALID_ARGUMENT' });
    }
    let ok = false;
    try { ok = await isAdmin(pubKey); } catch { ok = false; }
    if (!ok) {
      throw Object.assign(
        new Error(`community-catalog: ${pubKey} is not an admin of circle ${circleId} (${action} rejected)`),
        { code: 'FORBIDDEN' },
      );
    }
  }

  /**
   * Publish a signed endorsement into the community catalog. The endorsement's
   * `endorser` MUST be a circle admin — a non-admin write is REJECTED
   * (`code:'FORBIDDEN'`). The circle policy IS the gate.
   */
  async function endorse(rec) {
    if (!rec || typeof rec !== 'object' || typeof rec.endorser !== 'string') {
      throw Object.assign(new Error('community-catalog: endorse(rec) requires a signed endorsement'), { code: 'INVALID_ARGUMENT' });
    }
    await _assertAdmin(rec.endorser, 'endorse');
    return resource.append(rec);
  }

  /**
   * Moderation revoke: an ADMIN removes an endorsement by id → it drops from
   * every subscriber's derived catalog. `by` (the acting admin pubKey) is gated.
   */
  async function revoke(id, { by } = {}) {
    await _assertAdmin(by, 'revoke');
    return resource.revoke(id);
  }

  /**
   * Fork / exit — copy another community's (or curator's) VERIFIED endorsement
   * set into THIS community's resource, then diverge independently. An admin of
   * THIS circle (`by`) authorises the fork; the copied statements keep their
   * ORIGINAL signatures (endorser = the source curator), so they still verify —
   * fork needs no permission from the source and re-signs nothing (the design's
   * "portable signed statements"). Divergence afterwards is ordinary `endorse`
   * (add) / `revoke` (drop) by this circle's admins.
   *
   * Only endorsements that VERIFY against their resolved card survive the copy
   * (invalid/expired/cardHash-mismatch are dropped — you can't fork in rot).
   *
   * NOTE the trust seam: a forked endorsement's `endorser` is the SOURCE
   * curator, not one of D's admins — so for D's subscribers to reach it, D's
   * subscription must expose the forked source endorsers as roots too. The
   * returned `adoptedEndorsers` is exactly that set (wire it into the
   * subscription's community roots). See subscriptions.js.
   *
   * @param {object} opts
   * @param {string} opts.by            — acting admin pubKey (gated).
   * @param {object[]} opts.endorsements — source signed endorsements to adopt.
   * @param {(subject: string, endorsement: object) => (object|null|Promise<object|null>)} opts.resolveCard
   *   — resolves each subject's Agent Card (for verify).
   * @param {() => number} [opts.nowMs] — injectable clock for expiry checks.
   * @returns {Promise<{ adopted: number, skipped: number, adoptedEndorsers: string[] }>}
   */
  async function fork({ by, endorsements, resolveCard, nowMs } = {}) {
    await _assertAdmin(by, 'fork');
    const src     = Array.isArray(endorsements) ? endorsements : [];
    const resolve = typeof resolveCard === 'function' ? resolveCard : () => null;
    const adoptedEndorsers = new Set();
    let adopted = 0, skipped = 0;
    for (const rec of src) {
      const card  = await resolve(rec?.subject, rec);
      const actor = verifyEndorsement(rec, card, typeof nowMs === 'function' ? { now: nowMs } : undefined);
      if (!actor) { skipped += 1; continue; }        // don't fork in invalid/expired/mismatched statements
      await resource.append(rec);                     // keep the ORIGINAL sig — still verifies
      adoptedEndorsers.add(rec.endorser);
      adopted += 1;
    }
    return { adopted, skipped, adoptedEndorsers: [...adoptedEndorsers] };
  }

  return {
    endorse,
    revoke,
    fork,
    list: () => resource.list(),
    get:  (id) => resource.get(id),
    ensureAccess: () => resource.ensureAccess(),
    circleId,
    get resourceUri() { return uri; },
  };
}

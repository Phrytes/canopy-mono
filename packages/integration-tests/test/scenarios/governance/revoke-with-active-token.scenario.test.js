/**
 * Scenario: governance/revoke-with-active-token
 *
 * Story: Alice (a pod owner / agent) issues a `PodCapabilityToken` to Bob
 * granting read access to `/notes/`.  Bob holds the token and uses it via
 * a `PodClient`.  Bob's first read against Alice's pod succeeds.  Then
 * Alice revokes the token (she records the revocation in a local
 * RevocationStore + appends a `capability-revoked` event to her auth-log).
 * Alice's pod backend now denies any future request bearing that token
 * (HTTP 403 / `FORBIDDEN`).  Bob's NEXT read MUST fail with `CapabilityError`
 * (the pod-client's typed mapping for FORBIDDEN).
 *
 * Why this shape (vs. agent-skill CapabilityToken):
 *   The pod-client's `CapabilityError` is the explicit subclass for
 *   "token authentic but doesn't grant the requested operation" (pod-client
 *   `Errors.js`).  The strategy doc names `CapabilityError` as the failure
 *   contract, so this scenario exercises the pod-side capability path.
 *   The agent-side `requiredRole` path is separately exercised by
 *   `governance/role-demote-mid-call`.
 *
 * Lab setup: A single MockPod represents Alice's pod; a `PodClient` (Bob's
 * view) is wrapped with a stub Auth that always attaches Bob's token.  The
 * pod backend consults a tiny in-test `RevocationStore` keyed by token id
 * and throws FORBIDDEN once the token is on the revocation list.
 *
 * Action:
 *   1. Alice issues a PodCapabilityToken to Bob (signed, scoped to
 *      `pod.read:/notes/`).
 *   2. Bob reads `/notes/x.md` via PodClient → success.
 *   3. Alice revokes the token (RevocationStore.add(tokenId)) AND
 *      appends `capability-revoked` to her auth-log.
 *   4. Bob reads `/notes/x.md` again → backend throws FORBIDDEN →
 *      PodClient maps to `CapabilityError`.
 *
 * Assertion:
 *   - First read returns the resource.
 *   - Second read rejects with `CapabilityError` (instance + .code === 'FORBIDDEN').
 *   - Alice's auth-log records the revocation event with the token id.
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  AgentIdentity,
  VaultMemory,
  PodCapabilityToken,
  Bootstrap,
  IdentityPodStore,
} from '@canopy/core';

import { PodClient, CapabilityError } from '@canopy/pod-client';
import { MockPod }                    from '../../../src/_harness/index.js';

const POD_ROOT = 'https://alice.example/';
const NOTES    = POD_ROOT + 'notes/x.md';

/**
 * In-test revocation store.  Real deployments would persist this in
 * Alice's pod (see Track-A revocation list spec) and check it server-side.
 * For the scenario we model the server-side check as a simple per-uri
 * predicate over an in-memory Set.
 */
class RevocationStore {
  #ids = new Set();
  add(id)  { this.#ids.add(id); }
  has(id)  { return this.#ids.has(id); }
}

/**
 * Bob's stub Auth: attaches the token to every request.  We don't run a
 * real Solid server, so the auth contract is "produce headers / fetch wrapper"
 * — we expose the token id via a read-only field for the backend stub
 * to consult.
 */
function makeBobAuth(token) {
  return {
    tokenId: token.id,
    getAuthenticatedFetch: () => globalThis.fetch,
    identity: () => 'bob-test',
    close: () => {},
  };
}

/**
 * Wrap a MockPod with a SolidPodSource-shaped adapter that gates every
 * read/write through the RevocationStore: revoked → FORBIDDEN.  The auth
 * object's `tokenId` is injected by the closure (the auth instance lives
 * alongside the source factory).
 */
function makeRevocationAwareSource(mock, revocations, getTokenId) {
  function maybeForbid(uri) {
    const id = getTokenId();
    if (revocations.has(id)) {
      throw Object.assign(new Error(`Token ${id} has been revoked`),
        { code: 'FORBIDDEN', uri });
    }
  }
  function toBytes(content) {
    if (content instanceof Uint8Array)  return content;
    if (typeof content === 'string')    return new TextEncoder().encode(content);
    if (content instanceof ArrayBuffer) return new Uint8Array(content);
    return new TextEncoder().encode(JSON.stringify(content));
  }
  return {
    read: async (uri, opts) => {
      maybeForbid(uri);
      const r = await mock.read(uri, opts);
      const bytes = toBytes(r.content);
      return { ...r, content: bytes, size: bytes.byteLength };
    },
    write: async (uri, content, opts)    => { maybeForbid(uri); return mock.write(uri, content, opts); },
    list:  async (container, opts)       => { maybeForbid(container); return mock.list(container, opts); },
    delete: async (uri, opts)            => { maybeForbid(uri); return mock.delete(uri, opts); },
    exists: async (uri)                  => mock.exists(uri),
  };
}

describe('governance/revoke-with-active-token', () => {
  let aliceStore;
  afterEach(() => { aliceStore = null; });

  it('issued → revoked → CapabilityError on next invocation; auth-log records revocation', async () => {
    // ── Alice issues a PodCapabilityToken to Bob ───────────────────────
    const aliceVault    = new VaultMemory();
    const aliceIdentity = await AgentIdentity.generate(aliceVault);
    const bobVault      = new VaultMemory();
    const bobIdentity   = await AgentIdentity.generate(bobVault);

    const token = await PodCapabilityToken.issue(aliceIdentity, {
      subject:  bobIdentity.pubKey,
      pod:      POD_ROOT,
      scopes:   ['pod.read:/notes/'],
      expiresIn: 3_600_000,
    });
    expect(PodCapabilityToken.verify(token, POD_ROOT)).toBe(true);
    expect(token.subject).toBe(bobIdentity.pubKey);
    expect(token.issuer).toBe(aliceIdentity.pubKey);

    // ── Alice's pod (with content) and Bob's PodClient ─────────────────
    const alicePod    = new MockPod();
    await alicePod.write(NOTES, 'note content', { contentType: 'text/markdown' });

    const revocations = new RevocationStore();
    const bobAuth     = makeBobAuth(token);
    const bobClient   = new PodClient({
      podRoot: POD_ROOT,
      auth:    bobAuth,
      podSourceFactory: () =>
        makeRevocationAwareSource(alicePod, revocations, () => bobAuth.tokenId),
    });

    // ── 1. Bob reads while the token is still active → success ─────────
    const r1 = await bobClient.read(NOTES);
    expect(r1.content).toBe('note content');

    // ── 2. Alice revokes Bob's token + appends auth-log entry ──────────
    revocations.add(token.id);

    // Bootstrap.create() yields a valid 24-word phrase + Bootstrap; we only
    // need the encryption key derivation here, not recovery semantics.
    const { bootstrap: aliceBootstrap } = Bootstrap.create();
    aliceStore = new IdentityPodStore({
      podClient: alicePod,
      bootstrap: aliceBootstrap,
      identity:  aliceIdentity,
      podRoot:   POD_ROOT,
    });
    await aliceStore.init();
    await aliceStore.appendAuthEvent({
      event:  'capability-revoked',
      actor:  aliceIdentity.pubKey,
      target: bobIdentity.pubKey,
      at:     '2026-04-28T12:00:00Z',
      metadata: {
        tokenId: token.id,
        scopes:  token.scopes,
        pod:     POD_ROOT,
        reason:  'manual-revoke',
      },
    });

    // ── 3. Bob's next invocation MUST fail with CapabilityError ────────
    const err = await bobClient.read(NOTES).catch((e) => e);
    expect(err).toBeInstanceOf(CapabilityError);
    expect(err.code).toBe('FORBIDDEN');

    // ── 4. Auth-log shows the revocation event with the token id ───────
    const events = await aliceStore.readAuthLog('2026-04-28T12:30:00Z');
    const revoked = events.find((e) => e['dw:event'] === 'capability-revoked');
    expect(revoked, 'auth-log must record the revocation').toBeTruthy();
    expect(revoked['dw:actor']).toBe(aliceIdentity.pubKey);
    expect(revoked['dw:target']).toBe(bobIdentity.pubKey);
    expect(revoked['dw:metadata']?.tokenId).toBe(token.id);
    expect(typeof revoked['dw:signature']).toBe('string');

    // The post-revocation pod still holds the original content (revocation
    // is an authorisation event, not a data deletion).
    expect(alicePod.contentOf(NOTES)).toBe('note content');
  }, 8_000);
});

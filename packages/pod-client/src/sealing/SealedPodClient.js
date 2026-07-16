// SealedPodClient — transparent seal-on-write / open-on-read over any PodClient-shaped client.
//
// Only resource BODIES are sealed; structure (uris, containers, ACLs, etags) stays cleartext, so Solid
// semantics + the host's request-driven serving are unchanged — the host stores ciphertext it can't
// read (P2/P3). Content is treated as an opaque string: the caller serializes (pass a string to write;
// get the opened string back from read), matching how `project-seal` is used.
//
// The seal/open STRATEGY is injected (recipient-wrap or group-key) so key custody lives outside (e.g.
// @onderling/vault): the writer needs only public keys (or the group key); the reader needs a private key
// (or the group key). `open` passes plaintext through, so a pod with mixed sealed/legacy data still reads.

import {
  seal as recipientSeal, open as recipientOpen,
  sealWithGroupKey, openWithGroupKey,
} from './envelope.js';
import { unwrapGroupKey, openSealedAcrossVersions } from './groupKeyResource.js';

/**
 * Wrap a PodClient-shaped client with transparent seal-on-write / open-on-read of resource BODIES
 * only; structure ops and event plumbing are forwarded unchanged. The `{ seal, open }` strategy is
 * injected (recipient-wrap or group-key) and exposed on the returned client for out-of-band use;
 * `open` passes plaintext through, so mixed sealed/legacy data still reads.
 *
 * @param {object} inner   a PodClient (or compatible: read/write/append/list/...)
 * @param {{ seal: (text:string)=>string, open: (text:string)=>string }} strategy
 */
export function createSealedPodClient(inner, strategy) {
  if (!inner || typeof inner.read !== 'function' || typeof inner.write !== 'function') {
    throw new Error('createSealedPodClient: a PodClient with read/write is required');
  }
  if (!strategy || typeof strategy.seal !== 'function' || typeof strategy.open !== 'function') {
    throw new Error('createSealedPodClient: a { seal, open } strategy is required');
  }
  const { seal, open } = strategy;

  const api = {
    /** Seal the body, then write. Content is serialized to a string first (caller owns the shape). */
    async write(uri, content, opts = {}) {
      return inner.write(uri, seal(String(content)), opts);
    },
    /** Read raw (the sealed envelope is text), then open. Plaintext passes through. */
    async read(uri, opts = {}) {
      // `decode: 'string'` (NOT 'text', which isn't a real PodClient decode mode —
      // it falls through to `auto` and hands back raw BYTES for a non-text/* body,
      // so `open()` would never see the `fp1:` envelope string). 'string' forces a
      // TextDecoder pass regardless of the stored content-type. An in-memory client
      // that ignores `decode` and returns the raw string still works.
      const res = await inner.read(uri, { ...opts, decode: 'string' });
      return { ...res, content: open(res?.content) };
    },
    /** Seal each appended line (one envelope per line). */
    async append(uri, line, opts = {}) {
      if (typeof inner.append !== 'function') throw new Error('SealedPodClient: inner has no append');
      return inner.append(uri, seal(String(line)), opts);
    },
    /** Expose the strategy so callers can seal/open out-of-band (e.g. a sealed index blob). */
    seal, open,
  };

  // Forward the rest of the surface unchanged — structure ops + event plumbing don't touch bodies.
  for (const m of ['list', 'patch', 'createContainer', 'delete', 'deleteLocal', 'close',
                   'on', 'off', 'once', 'removeAllListeners', 'listenerCount']) {
    if (typeof inner[m] === 'function' && !(m in api)) {
      api[m] = (...args) => inner[m](...args);
    }
  }
  api.inner = inner;
  return api;
}

/** Recipient-wrap strategy: seal to public keys (host-blind writer), open with a private key. */
export function recipientStrategy({ recipients, privateKey } = {}) {
  return {
    seal: (text) => {
      if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
        throw new Error('recipientStrategy: recipients (public keys) required to seal');
      }
      return recipientSeal(text, recipients);
    },
    open: (text) => {
      if (!privateKey) throw new Error('recipientStrategy: a private key is required to open');
      return recipientOpen(text, privateKey);
    },
  };
}

/**
 * Group-key strategy: seal/open under the household shared pod's group key. Two constructions, both
 * returning the same `{ seal, open }` shape:
 *
 *   • SINGLE-KEY (back-compat): `groupKeyStrategy({ groupKey })`. `seal` and `open` both use that one
 *     symmetric key — byte-for-byte the pre-Phase-3 behaviour. Content that has never rotated round-trips
 *     exactly as before (the single-version fast path).
 *
 *   • CROSS-VERSION reader (Phase 3): `groupKeyStrategy({ resource, privateKey })`, where `resource` is the
 *     retained group-key resource (the CURRENT version + its `history[]` of prior versions) and `privateKey`
 *     is the reader's sealing key. `open` resolves the version the content was sealed under by AUTHENTICATED
 *     TRIAL across EVERY version this reader can unwrap (`openSealedAcrossVersions` → `readableGroupKeys`), so
 *     ordinary content sealed under an OLDER key version — before a rotation the reader lived through — still
 *     opens for a still-entitled member. `seal` ALWAYS writes under the CURRENT version (`unwrapGroupKey`,
 *     unwrapped lazily): a caller who is not a current recipient (a revoked member) throws on `seal` and
 *     cannot write new content.
 *
 *     FORWARD SECRECY: `readableGroupKeys(resource, privateKey)` yields ONLY the versions whose envelope this
 *     private key is a recipient of. A reader revoked at a rotation is absent from the current version's
 *     envelope and from every later one, so their readable set holds ONLY pre-revocation versions — they can
 *     open old (pre-revocation) content they were already entitled to, and NEVER content sealed under a
 *     post-revocation key (that trial finds no key that opens it → throws). Retention only restores a current
 *     member's access to pre-rotation content; it never grants a revoked member access to post-revocation
 *     content.
 */
export function groupKeyStrategy({ groupKey, resource, privateKey } = {}) {
  if (resource) {
    if (!privateKey) throw new Error('groupKeyStrategy: a private key is required to open a group-key resource across versions');
    return {
      // seal ALWAYS under the CURRENT version; unwrapGroupKey throws if this key is not a current recipient
      // (a revoked member can't write). Unwrapped lazily so an open-only reader (revoked, historic access)
      // can still be constructed without throwing here.
      seal: (text) => sealWithGroupKey(text, unwrapGroupKey(resource, privateKey)),
      // open across every version this reader can unwrap (current + retained history). Non-sealed text passes
      // through; sealed content the reader holds no version for throws — the forward-secrecy denial.
      open: (text) => openSealedAcrossVersions(text, resource, privateKey),
    };
  }
  if (!groupKey) throw new Error('groupKeyStrategy: a group key (or a resource + private key) is required');
  return {
    seal: (text) => sealWithGroupKey(text, groupKey),
    open: (text) => openWithGroupKey(text, groupKey),
  };
}

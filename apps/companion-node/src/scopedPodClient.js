/**
 * companion-node R2b.1 — the SCOPE-ENFORCING pod gate.
 *
 * R2b.0 (merged) landed the pod-SIDE verifier in `@canopy/pod-client`
 * (`createPodTokenVerifier` + `scopeForRequest`): given a request (op + path) and
 * a presented `PodCapabilityToken` it decides — deny-by-default — whether the
 * token actually authorizes that request (signature · expiry · issuer-trust ·
 * scope · revocation). R2b.1 puts that verifier to WORK: it wraps the host's
 * held dev pod client so the host reads/writes the pod ONLY within a delegated
 * token's scope.
 *
 * `ScopedPodClient` presents a fixed `PodCapabilityToken` (injected — R2b.2
 * delivers it over the `authorizePod` handshake) and, for EVERY pod method a
 * caller invokes, derives the `requiredScope` from (op, path), runs the verifier,
 * and either delegates to the held client (allow) or throws an OPAQUE 403 that
 * does NOT leak which scope was missing (deny). Same posture as the media gate.
 *
 * ── AUDIT: which methods does the folio core surface actually reach? ──
 * The ONLY held-pod-client method any relocatable folio core invokes today is
 * `.list()` — via `listFiles({source:'pod'})` → `store.listPodFolio` →
 * `podClient.list(uri)` (see apps/folio/src/agentCores.js:99 + folioPodList.js).
 * `readNote`/`deleteFromPod` mutate the in-process seed index (NOT the pod);
 * `shareFolder` signs a token locally without the held pod source. So gating
 * `.list` alone covers 100% of today's pod leg. We nonetheless gate EVERY pod
 * I/O method the `FsBackedMockPodClient` exposes (read/write/list/delete/
 * deleteLocal/clearTombstone) so a future core that reaches for one is gated by
 * construction — a gate with a hole is worse than no gate.
 *
 * ── IN-PROCESS vs HTTP (honesty) ──
 * The companion's pod source is the IN-MEMORY `FsBackedMockPodClient`, not an
 * HTTP `PodClient`, so there is no real Bearer-over-HTTP round-trip here. We do
 * NOT fabricate one. Enforcement is IN-PROCESS: this gate holds the token +
 * verifier and checks per-op before delegating. That is REAL scope/expiry/
 * revocation enforcement, but NOT a network-adversary boundary — that arrives
 * with a real HTTP pod / a `CapabilityAuth` `pod-direct` presentation at R3.
 * The seams are kept distinct (token-presentation `#token` vs scope-check
 * `#guard`) so a real pod-HTTP boundary slots in at R3 without a rewrite.
 */
import { scopeForRequest } from '@canopy/pod-client';

/** Opaque 403 — never reveals which scope was required (no oracle for probing). */
function podForbidden() {
  const err = new Error('pod access denied');
  err.code = 'POD_FORBIDDEN';
  err.status = 403;
  return err;
}

export class ScopedPodClient {
  /** the held (real) pod client — reached ONLY after a scope check passes */
  #inner;
  /** the presented PodCapabilityToken (injected now; R2b.2 delivers it) */
  #token;
  /** the R2b.0 verifier: async ({token, requiredScope, expectedPod}) → actor|null */
  #verify;
  /** the pod root this token is bound to (verifier's `expectedPod`) */
  #podRoot;

  /**
   * @param {object}   args
   * @param {object}   args.inner    held pod client (e.g. FsBackedMockPodClient)
   * @param {object}   args.token    the presented PodCapabilityToken (or its wire form)
   * @param {Function} args.verify   verifier from `createPodTokenVerifier(...)`
   * @param {string}   args.podRoot  pod root URI the token is bound to (expectedPod)
   */
  constructor({ inner, token, verify, podRoot }) {
    if (!inner)                        throw new Error('ScopedPodClient: inner pod client required');
    if (!token)                        throw new Error('ScopedPodClient: token required');
    if (typeof verify !== 'function')  throw new Error('ScopedPodClient: verify(fn) required');
    if (typeof podRoot !== 'string' || podRoot.length === 0) {
      throw new Error('ScopedPodClient: podRoot required');
    }
    this.#inner   = inner;
    this.#token   = token;
    this.#verify  = verify;
    this.#podRoot = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
  }

  /** Absolute pod URI → the pod-relative path the token scopes are written in. */
  #relPath(uri) {
    const s = String(uri ?? '');
    if (s.startsWith(this.#podRoot)) return `/${s.slice(this.#podRoot.length)}`;
    if (s.startsWith('/'))           return s;             // already pod-relative
    return `/${s}`;                                        // best-effort
  }

  /**
   * The single scope seam every method funnels through: derive the required
   * scope from (op, uri), verify the presented token, throw an opaque 403 on
   * deny, return silently on allow. Deny-by-default: any verifier null → 403.
   */
  async #guard(op, uri) {
    const requiredScope = scopeForRequest(op, this.#relPath(uri));
    const actor = await this.#verify({
      token:        this.#token,
      requiredScope,
      expectedPod:  this.#podRoot,
    });
    if (!actor) throw podForbidden();
  }

  // ── Gated pod I/O — one guard per op, then delegate verbatim ──────────────
  // read/list map to the `read` action; write/clearTombstone to `write`;
  // delete/deleteLocal to `delete` (see scopeForRequest's op→action map).

  async list(uri, opts) {
    await this.#guard('list', uri);
    return this.#inner.list(uri, opts);
  }

  async read(uri, opts) {
    await this.#guard('read', uri);
    return this.#inner.read(uri, opts);
  }

  async write(uri, content, opts) {
    await this.#guard('write', uri);
    return this.#inner.write(uri, content, opts);
  }

  async delete(uri) {
    await this.#guard('delete', uri);
    return this.#inner.delete(uri);
  }

  async deleteLocal(uri) {
    await this.#guard('delete', uri);
    return this.#inner.deleteLocal(uri);
  }

  async clearTombstone(uri) {
    await this.#guard('write', uri);
    return this.#inner.clearTombstone(uri);
  }

  // ── Passthroughs with NO pod access (safe to expose ungated) ──────────────
  get podRoot() { return this.#inner.podRoot; }
  on()   { return this.#inner.on?.(); }
  off()  { return this.#inner.off?.(); }
  emit() { return this.#inner.emit?.(); }
}

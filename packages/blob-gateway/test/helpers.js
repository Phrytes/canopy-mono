// Test doubles for the injected contracts — an in-memory bucket, a fake token verifier,
// and a fake ACL. No real cloud SDK, no HTTP server (that is the deferred next slice).

/** In-memory object bucket. `presign` returns a fake URL that `fetchPresigned` resolves back
 *  to the stored bytes — modelling "the URL grants access to the ciphertext". */
export function makeMemoryBucket() {
  const store = new Map();
  const presigns = new Map(); // url -> { key, expiresAt }
  let n = 0;
  return {
    store,
    async put(key, bytes) { store.set(key, bytes); },
    async presign(key, { ttl } = {}) {
      if (!store.has(key)) return null;
      const url = `https://bucket.example/presigned/${key}?sig=${++n}`;
      presigns.set(url, { key, expiresAt: Date.now() + (ttl ?? 60) * 1000 });
      return url;
    },
    async delete(key) { store.delete(key); },
    // Test-only: resolve a presigned URL to the stored (cipher)bytes.
    async fetchPresigned(url) {
      const rec = presigns.get(url);
      if (!rec || Date.now() > rec.expiresAt) return null;
      return store.get(rec.key);
    },
  };
}

/** Fake verifier: a map of token -> webId. Unknown token => null. */
export function makeVerifier(tokenToWebId) {
  return async (token) => {
    const webId = tokenToWebId[token];
    return webId ? { webId } : null;
  };
}

/** Fake ACL: a set of "<webId>|<ref>" grants. Deny-by-default. */
export function makeAcl(grants = []) {
  const allowed = new Set(grants.map(([w, r]) => `${w}|${r}`));
  return {
    async canRead(webId, ref) { return allowed.has(`${webId}|${ref}`); },
    grant(webId, ref) { allowed.add(`${webId}|${ref}`); },
  };
}

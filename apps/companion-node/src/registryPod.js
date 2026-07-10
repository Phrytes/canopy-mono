/**
 * companion-node — the registry pod for R1.
 *
 * `registerFolioAgent` → `registerAgentBundle` → `createAgentRegistry` needs a
 * pseudoPod with `read(uri) -> { bytes, etag } | null` and `write(uri, body)`.
 * The REGISTRY LOGIC is real (`createAgentRegistry` runs unchanged — real
 * resource shape, real CAS mutate, real capability list); only the STORAGE is
 * an in-memory Map for R1.  This mirrors folio's own Node registration tests
 * (`apps/folio/test/registerFolioAgent.test.js#makePseudoPodStub`).
 *
 * In the shared-relay production topology (decision #5) the registry resource
 * lives in the user's pod (a cache-mode `@canopy/pseudo-pod`); the device reads
 * the SAME resource to discover the host.  For a hermetic in-process R1 proof,
 * the host and the device share this one Map instance — the honest analog of a
 * shared pod resource: the device runs a REAL `createAgentRegistry` over it and
 * really lists the host's registered pubKey + capabilities.
 */

/**
 * @returns {{ read(uri:string): Promise<{bytes:any, etag:null}|null>,
 *             write(uri:string, body:any): Promise<{etag:null}>,
 *             _map: Map<string, any> }}
 */
export function makeMemoryRegistryPod() {
  const map = new Map();
  return {
    _map: map,
    async read(uri) {
      return map.has(uri) ? { bytes: map.get(uri), etag: null } : null;
    },
    async write(uri, body) {
      map.set(uri, body);
      return { etag: null };
    },
  };
}

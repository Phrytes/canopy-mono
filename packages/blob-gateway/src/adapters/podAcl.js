// podAcl.js — the REAL ACL adapter satisfying the v0 `acl` contract:
//
//   { canRead(webId, ref) => Promise<bool> }
//
// backed by a Solid pod's ACP/WAC access controls via `@canopy/pod-client`'s
// `client.sharing.list` — the SAME surface the cross-circle sharing work uses.
//
//   createPodAcl({ sharing, resolveResourceUri?, mode? })
//
// The blob ref (`blob://<bucketKey>`) does NOT itself name a pod resource — the
// authoritative ACL lives on the POD ITEM that embeds the blob (the cross-pod-ref
// manifest line). So the caller injects `resolveResourceUri(ref) => podResourceUri`
// mapping a blob ref to the governing pod resource. `sharing` is INJECTED (duck-
// typed `{ list }`), so this is testable with a mock sharing surface and NO live
// pod.
//
// DENY-BY-DEFAULT: no resolver / unresolved ref / list throws / no matching read
// grant → false. Only an explicit read grant for this agent (or a public read
// grant) returns true.

export function createPodAcl({ sharing, resolveResourceUri, mode = 'read' } = {}) {
  if (!sharing || typeof sharing.list !== 'function') {
    throw new Error('createPodAcl: a `sharing` surface with list() is required (client.sharing from @canopy/pod-client)');
  }
  const resolve = typeof resolveResourceUri === 'function' ? resolveResourceUri : defaultResolve;

  return {
    async canRead(webId, ref) {
      try {
        if (!webId || typeof webId !== 'string') return false;

        const resourceUri = await resolve(ref);
        if (!resourceUri || typeof resourceUri !== 'string') return false;

        // Ask the pod ONLY about this agent (the SDK can't enumerate all agents).
        const grants = await sharing.list({ resourceUri, agentsToQuery: [webId] });
        if (!Array.isArray(grants)) return false;

        return grants.some((g) =>
          g && Array.isArray(g.modes) && g.modes.includes(mode) && (
            (g.subject === 'agent' && g.agent === webId) ||
            g.subject === 'public'
          ),
        );
      } catch {
        // Any failure denies — never fail open.
        return false;
      }
    },
  };
}

/** Default resolver: an http(s) ref governs itself; anything else (e.g. a raw
 *  `blob://` ref with no injected mapping) is unresolvable → deny. */
function defaultResolve(ref) {
  if (typeof ref === 'string' && /^https?:\/\//.test(ref)) return ref;
  return null;
}

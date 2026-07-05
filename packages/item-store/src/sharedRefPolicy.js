/**
 * sharedRefPolicy — the injectable ENFORCEMENT surface for the cross-circle read (cluster K).
 *
 * `resolveSharedRef` (shareIntoAudience.js) resolves a `shared-ref` back to its source item — the read
 * that CROSSES circles. On the in-memory substrate that read is unguarded (there is no real pod to gate
 * against). On a real pod the source item lives behind ACP/WAC and, if confidential, inside a sealed
 * envelope. This module is the seam that lets `resolveSharedRef` ENFORCE that posture WITHOUT item-store
 * taking a hard dependency on `@canopy/pod-client`: the pod-layer surfaces (`client.sharing`, sealing
 * `open`) are INJECTED; this file only adapts their shapes to a tiny policy contract.
 *
 * The policy contract:
 *   {
 *     // Deny-by-default grant gate. Return truthy to allow the read; falsy/throw ⇒ resolveSharedRef → null.
 *     checkGrant?: ({ ref, recipient, stores }) => boolean | Promise<boolean>,
 *     // Transform the resolved source item → readable item (unseal). Return the item unchanged when
 *     //   there is nothing to open. Throw ⇒ deny (don't leak ciphertext).
 *     open?: (item, { ref, recipient }) => object | Promise<object>,
 *   }
 *
 * Two builders ship here:
 *   • makeSharedRefPolicy — pod-backed: verifies a real ACP/WAC read grant via an injected `sharing`
 *     surface (the `client.sharing.list` shape) and unseals via an injected `open` (the sealing/`open`
 *     shape). No import of pod-client — the surfaces are passed in.
 *   • makePosturePolicy — memory substrate: enforces the ALREADY-MODELED posture floor (the recipient
 *     circle's confidentiality must meet the ref's `posture`). Testable without a live pod.
 */

/**
 * Walk an item's own string fields and run each through `openText`. `openText` (the sealing/`open` shape)
 * passes non-sealed text through unchanged, so this is safe to run over every string field — plaintext
 * stays plaintext, only sealed envelopes are opened. Returns a NEW item (never mutates the stored one).
 *
 * @param {object} item
 * @param {(text:string)=>string|Promise<string>} openText
 */
export async function unsealItem(item, openText) {
  if (!item || typeof item !== 'object' || typeof openText !== 'function') return item;
  const out = { ...item };
  for (const [k, v] of Object.entries(item)) {
    if (typeof v === 'string') out[k] = await openText(v);
  }
  return out;
}

/**
 * Pod-backed enforcement policy. Adapts the injected pod-layer surfaces to the policy contract.
 *
 * @param {object} opts
 * @param {{ list:(o:object)=>Promise<Array<{subject:string,agent?:string,modes:string[]}>> }} opts.sharing
 *        the `client.sharing` surface (Phase 52.16). We call `sharing.list({ resourceUri, agentsToQuery })`
 *        and require a `read` grant for the recipient (or a public read grant).
 * @param {(text:string)=>string|Promise<string>} [opts.open]  the sealing/`open` shape — opens a sealed
 *        envelope with the reader's key; passes plaintext through. Omit to skip unsealing.
 * @param {string} [opts.recipient]  the WebID/agent asking to read (default recipient for checkGrant).
 * @param {(ref:object, ctx:{stores:object})=>(string|null)} [opts.resourceUriFor]  maps a `shared-ref` to
 *        the source item's pod resource URI (the ACP-controlled target). Defaults to a logical
 *        `sourceCircle/sourceId` — a real pod MUST inject the true storage-layout URI (that derivation is
 *        the pod-storage-tier's job; see the boundary note in the K report).
 * @param {string} [opts.mode='read']  the access mode a grant must include to allow the read.
 * @returns {{ checkGrant: Function, open?: Function }}
 */
export function makeSharedRefPolicy({ sharing, open, recipient, resourceUriFor, mode = 'read' } = {}) {
  if (!sharing || typeof sharing.list !== 'function') {
    throw new Error('makeSharedRefPolicy: a { list } sharing surface (client.sharing) is required');
  }
  const uriFor = typeof resourceUriFor === 'function'
    ? resourceUriFor
    : (ref) => (ref && ref.sourceCircle && ref.sourceId ? `${ref.sourceCircle}/${ref.sourceId}` : null);

  return {
    async checkGrant({ ref, recipient: who = recipient, stores } = {}) {
      // Deny-by-default: no recipient identity to check a grant for ⇒ deny.
      if (!who) return false;
      const resourceUri = uriFor(ref, { stores });
      if (!resourceUri) return false;
      const grants = await sharing.list({ resourceUri, agentsToQuery: [who] });
      if (!Array.isArray(grants)) return false;
      // Allow when the source circle granted this recipient (or the public) the required mode.
      return grants.some((g) =>
        Array.isArray(g?.modes) && g.modes.includes(mode) &&
        (g.subject === 'public' || g.agent === who));
    },
    ...(typeof open === 'function'
      ? { open: (item) => unsealItem(item, open) }
      : {}),
  };
}

/**
 * Memory-substrate enforcement policy. There is no real pod to grant against, so we enforce the posture
 * that shareIntoAudience already MODELS: the `shared-ref` carries the item's required `posture` (the
 * confidentiality floor), and the recipient circle has its own confidentiality via `postureOf`. The read
 * is allowed only when the recipient meets the floor — the same rule the SHARE op used to refuse a
 * downgrade, now enforced on the READ. Deny-by-default when the floor can't be met.
 *
 * @param {object} opts
 * @param {(circleId:string)=>number} opts.postureOf  the recipient circle's confidentiality.
 * @param {string} [opts.recipient]  the recipient circle id (default for checkGrant).
 * @param {(text:string)=>string|Promise<string>} [opts.open]  optional group opener for sealed content.
 * @returns {{ checkGrant: Function, open?: Function }}
 */
export function makePosturePolicy({ postureOf, recipient, open } = {}) {
  if (typeof postureOf !== 'function') {
    throw new Error('makePosturePolicy: a postureOf(circleId)=>number is required');
  }
  return {
    checkGrant({ ref, recipient: who = recipient } = {}) {
      if (!who) return false;                                  // deny-by-default: no recipient ⇒ deny
      const floor = Number(ref?.posture) || 0;
      const have = Number(postureOf(who)) || 0;
      return have >= floor;
    },
    ...(typeof open === 'function'
      ? { open: (item) => unsealItem(item, open) }
      : {}),
  };
}

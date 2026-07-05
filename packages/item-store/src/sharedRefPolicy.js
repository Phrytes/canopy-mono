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
 * WRITE-SIDE companion to `makeSharedRefPolicy` — the injectable grant(+seal) hook a SHARE performs on a
 * pod-backed store. `shareIntoAudience` writes the `shared-ref` (memory op, unchanged) and then, if an
 * `onShare` hook is injected, calls it so the pod layer can make the read ACTUALLY possible: create the
 * ACP read-grant for the recipient on the SOURCE item's resource, and (optionally) re-seal so the recipient
 * can open the envelope. No `@canopy/pod-client` import — the `sharing.grant` + `seal` surfaces are passed in
 * (mirroring how the read policy injects `sharing.list` + `open`).
 *
 * Symmetry with the read gate: the read gate (`makeSharedRefPolicy.checkGrant`) asks "does recipient have a
 * read grant on `resourceUriFor(ref)`?"; this hook is what PUTS that grant there. Same `resourceUriFor`, same
 * `mode` ⇒ a share made by this hook resolves through that gate, and only that recipient's.
 *
 * @param {object} opts
 * @param {{ grant:(o:object)=>Promise<any> }} opts.sharing  the `client.sharing` surface — we call
 *        `sharing.grant({ resourceUri, agent, modes })` once per recipient.
 * @param {(ref:object)=>(string|null)} [opts.resourceUriFor]  maps a `shared-ref` → the source item's pod
 *        resource URI (the ACP target). Defaults to the logical `sourceCircle/sourceId` (a real pod injects
 *        the storage-layout URI from `@canopy/pod-onboarding`'s `sharedRefResourceUri`).
 * @param {string} [opts.mode='read']  the access mode to grant.
 * @param {(item:object, ctx:{recipient:string, ref:object})=>object|Promise<object>} [opts.seal]  optional
 *        re-seal step. In the group-key posture the recipient already holds the key so no re-seal is needed
 *        (omit); in the recipient-wrap posture, inject a `seal` that returns the item re-sealed to include
 *        `recipient`, and it is written back to the source store so the recipient can open it at rest.
 * @returns {(ctx:{ref:object, item:object, recipient?:string, recipients?:string[], stores:object})=>Promise<void>}
 */
export function makeShareGrantHook({ sharing, resourceUriFor, mode = 'read', seal } = {}) {
  if (!sharing || typeof sharing.grant !== 'function') {
    throw new Error('makeShareGrantHook: a { grant } sharing surface (client.sharing) is required');
  }
  const uriFor = typeof resourceUriFor === 'function'
    ? resourceUriFor
    : (ref) => (ref && ref.sourceCircle && ref.sourceId ? `${ref.sourceCircle}/${ref.sourceId}` : null);

  return async function onShare({ ref, item, recipient, recipients, stores } = {}) {
    const resourceUri = uriFor(ref);
    if (!resourceUri) throw new Error('makeShareGrantHook: no resource URI for the shared-ref');

    // Who gets the read grant. A circle share resolves to one or more recipient WebIDs at the composition
    // layer (via @canopy/circles) and passes them in; deny-by-default: no recipient ⇒ refuse the share.
    const who = Array.isArray(recipients) && recipients.length ? recipients
      : (recipient ? [recipient] : []);
    if (who.length === 0) throw new Error('makeShareGrantHook: at least one recipient is required to grant');

    for (const agent of who) {
      await sharing.grant({ resourceUri, agent, modes: [mode] });
    }

    // Optional re-seal so the (new) recipient can open the envelope at rest. Group-key postures skip this.
    if (typeof seal === 'function' && item && ref && stores && typeof stores.getStore === 'function') {
      const sealed = await seal(item, { recipient: who[0], recipients: who, ref });
      if (sealed && sealed !== item) {
        await stores.getStore(ref.sourceCircle).put({ ...sealed, id: ref.sourceId });
      }
    }
  };
}

/**
 * ONE-CALL pod-tier wiring for the cross-circle share (cluster K · the composition seam). Binds the
 * WRITE-side grant hook and the READ-side enforcement policy to the SAME `sharing` surface, `resourceUriFor`
 * mapping, and `mode` — so a share made through `onShare` is exactly what `policy.checkGrant` will later
 * accept, and nothing else. The pod-backed composition point injects the live surfaces here and threads the
 * result into `shareIntoAudience(stores, { …, onShare })` + `resolveSharedRef(stores, ref, { policy, recipient })`.
 *
 * No `@canopy/pod-client` import: `sharing` (`{ grant, list }` = `client.sharing`), `open`/`seal` (sealing
 * with key custody), and `resourceUriFor` (from `@canopy/pod-onboarding`'s `sharedRefResourceUri`) are all
 * injected. Deny-by-default is preserved on the read side; the write side refuses a grant-less share.
 *
 * @param {object} opts
 * @param {{ grant:Function, list:Function }} opts.sharing  the `client.sharing` surface.
 * @param {(ref:object)=>(string|null)} opts.resourceUriFor  the canonical source-item URI resolver.
 * @param {string} [opts.recipient]  default recipient WebID (read gate + single-recipient shares).
 * @param {(text:string)=>string|Promise<string>} [opts.open]  sealing open (read side).
 * @param {(item:object, ctx:object)=>object|Promise<object>} [opts.seal]  optional re-seal (write side).
 * @param {string} [opts.mode='read']  the access mode granted + required. Must match on both sides.
 * @returns {{ onShare: Function, policy: { checkGrant: Function, open?: Function } }}
 */
export function makeCircleShareEnforcement({ sharing, resourceUriFor, recipient, open, seal, mode = 'read' } = {}) {
  if (!sharing || typeof sharing.grant !== 'function' || typeof sharing.list !== 'function') {
    throw new Error('makeCircleShareEnforcement: a { grant, list } sharing surface (client.sharing) is required');
  }
  return {
    onShare: makeShareGrantHook({ sharing, resourceUriFor, mode, seal }),
    policy:  makeSharedRefPolicy({ sharing, open, recipient, resourceUriFor, mode }),
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

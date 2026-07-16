/**
 * `createGate` — the HOST-LEVEL deterministic token-gate projection.
 *
 * Part A of PLAN-manifest-gate-surfaces: lift the gate runtime to a substrate so
 * consumers get a COMPOSED, host-level gate instead of reaching into
 * `@onderling/app-manifest`'s projector directly (the layering that circleGate.js
 * used to violate via a deep relative import of `renderGate.js`).
 *
 * This is a LIFT + COMPOSE, not a rewrite of the gate rules: the gate rules are
 * still produced by app-manifest's `renderGate` (manifest → `{name,test,command}`
 * first-match-wins across apps), with the SAME semantics/output. What the host
 * adds is composition — take the host's mounted manifests (or an explicit list)
 * and project them into one flattened, ordered rule set.
 *
 *   createGate(host)                       // a mounted @onderling/manifest-host
 *   createGate([manifestA, manifestB], opts)
 *   createGate(manifest, opts)
 *     → { rules: Array<{ name, test, command }> }
 *
 * `rules` is exactly `renderGate(manifests, opts)` — a caller feeds it straight
 * into a token-gate engine (e.g. basis's `createTokenGate({ rules })`).
 * Returning an object (not a bare array) leaves room for the wider Part-A engine
 * (`.evaluate` / multi-command / retrieve) to attach here later without breaking
 * this call site.
 *
 * @param {import('./ManifestHost.js').Host | object | object[]} source
 *   a manifest-host instance, a single manifest, or a list of manifests.
 * @param {{ locale?: string, trailLexicon?: object }} [opts]
 *   forwarded verbatim to `renderGate` (per-locale TRAILING-verb pass); inert when omitted.
 * @returns {{ rules: Array<{ name:string, test:()=>boolean, command:(text:string)=>({opId:string,args:object,appOrigin?:string}|null) }> }}
 */
import { renderGate } from '@onderling/app-manifest';

export function createGate(source, opts = {}) {
  const manifests = manifestsFrom(source);
  const rules = renderGate(manifests, opts);
  return { rules };
}

/**
 * Normalize the input into a manifest list.  A Host is detected structurally by
 * its `manifests()` accessor (mount-order manifests); anything else is treated
 * as a single manifest or an already-composed list.
 */
function manifestsFrom(source) {
  if (source && typeof source.manifests === 'function') return source.manifests();
  return Array.isArray(source) ? source : [source];
}

// CSS auth helpers (Tier 3c) — build an authenticated fetch + a central pod over a live CSS,
// so the channel surfaces can use a REAL participant pod instead of the in-memory default.
// Two paths:
//   • server-side (Telegram bot service, activation service): Solid-OIDC client credentials
//     → a DPoP fetch (clientCredentialsFetch).
//   • browser (canopy-chat): the host already holds a @inrupt/solid-client-authn-browser
//     fetch (keys from @canopy/vault) — pass it straight to makeCssCentralPod as authedFetch.
//
// The Node auth lib is dynamically imported so the app stays dependency-free; inject `authn`
// to decouple in tests.

import { CssCentralPod } from './css-central-pod.js';

/** Solid-OIDC client-credentials → an authenticated DPoP fetch (Node side). */
export async function clientCredentialsFetch({ cssUrl, clientId, clientSecret, authn } = {}) {
  if (!cssUrl || !clientId || !clientSecret) throw new Error('clientCredentialsFetch: cssUrl, clientId, clientSecret required');
  // Node-only auth lib, loaded lazily. The indirect specifier + @vite-ignore keep it opaque to
  // browser bundlers (canopy-chat reaches this file but only ever uses the authedFetch path).
  const spec = '@inrupt/solid-client-authn-core';
  const lib = authn || await import(/* @vite-ignore */ spec);
  const { createDpopHeader, generateDpopKeyPair, buildAuthenticatedFetch } = lib;
  const base = cssUrl.replace(/\/$/, '');
  const oidc = await (await fetch(`${base}/.well-known/openid-configuration`)).json();
  const dpopKey = await generateDpopKeyPair();
  const basic = Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64');
  const tok = await (await fetch(oidc.token_endpoint, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', dpop: await createDpopHeader(oidc.token_endpoint, 'POST', dpopKey) },
    body: 'grant_type=client_credentials&scope=webid',
  })).json();
  return buildAuthenticatedFetch(tok.access_token, { dpopKey });
}

/**
 * A CssCentralPod from either an existing `authedFetch` (browser) or credentials (server).
 * Pass `flat:true` when podBase is the participant's OWN container (canopy-chat pre-send).
 * @param {{ podBase:string, flat?:boolean, authedFetch?:Function, cssUrl?:string, clientId?:string, clientSecret?:string, authn?:object }} a
 */
export async function makeCssCentralPod({ podBase, flat = false, authedFetch, cssUrl, clientId, clientSecret, authn } = {}) {
  if (!podBase) throw new Error('makeCssCentralPod: podBase required');
  const fetchImpl = authedFetch || await clientCredentialsFetch({ cssUrl, clientId, clientSecret, authn });
  return new CssCentralPod({ authedFetch: fetchImpl, podBase, flat });
}

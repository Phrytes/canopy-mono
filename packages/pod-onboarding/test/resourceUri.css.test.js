/**
 * CSS integration test for the cluster-K pod-tier wiring — a REAL grant→read round-trip.
 *
 * Wires the three delivered pieces against a live Community Solid Server:
 *   • `makeResourceUriResolver` / `sharedRefResourceUri` (@canopy/pod-onboarding) — the canonical
 *     `group/<circle>/<type>/<item>` ACP target.
 *   • `makeCircleShareEnforcement` (@canopy/item-store) — the write-side grant hook + read-side policy,
 *     bound to the SAME resolver, over a live `client.sharing` (@canopy/pod-client).
 *   • `shareIntoAudience` / `resolveSharedRef` — the share op + the gated cross-circle read.
 *
 * The composition that exists today keeps the item CONTENT in a memory `CircleItemStore` (there is no
 * pod-backed `core.DataSource` yet — the L1b PodBackend). The ACP GATE, however, is exercised for real:
 * the grant is written to a live pod and `resolveSharedRef` only resolves when `client.sharing.list` sees it.
 *
 * Gating mirrors `packages/pod-client/test/sharing/sharing.css.test.js` — skips cleanly without a running
 * CSS (`CSS_URL` + client-credentials), so `npm test` / the repo sweep stay green.
 *
 * ⚠️ Same EXPECTED caveat as sharing.css.test.js: against CSS 7.1.9 + @inrupt/solid-client 3.0.0 a `grant()`
 * may not be observable via `list()` (round-trip incompatibility). This file asserts the DESIRED contract on
 * purpose — its red is the coverage signal, not a regression. Gate-OFF skips cleanly.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CSS_URL   = process.env.CSS_URL;
const HAVE_OIDC = !!(process.env.CSS_CLIENT_ID && process.env.CSS_CLIENT_SECRET);
const SUITE = CSS_URL && HAVE_OIDC ? describe : describe.skip;

let PodClient, SolidOidcAuth, SolidVault, VaultMemory;
let makeResourceUriResolver, sharedRefResourceUri;
let createCircleStores, memoryDataSource, shareIntoAudience, resolveSharedRef, makeCircleShareEnforcement;

beforeAll(async () => {
  if (!CSS_URL || !HAVE_OIDC) return;
  ({ PodClient, SolidOidcAuth } = await import('@canopy/pod-client'));
  ({ VaultMemory } = await import('@canopy/vault'));
  ({ SolidVault } = await import('@canopy/oidc-session'));
  ({ makeResourceUriResolver, sharedRefResourceUri } = await import('../src/resourceUri.js'));
  ({
    createCircleStores, memoryDataSource, shareIntoAudience, resolveSharedRef, makeCircleShareEnforcement,
  } = await import('@canopy/item-store'));
});

SUITE('cluster-K pod-tier wiring — CSS grant→read round-trip', () => {
  const scratch = process.env.CSS_SCRATCH || 'scratch/';
  const grantee = process.env.CSS_GRANTEE_WEBID || `${CSS_URL}grantee/profile/card#me`;

  async function makeClient() {
    const vault = new VaultMemory();
    const sv = new SolidVault({ webid: process.env.CSS_WEBID || `${CSS_URL}profile/card#me`, vault });
    await sv.login({
      clientId:     process.env.CSS_CLIENT_ID,
      clientSecret: process.env.CSS_CLIENT_SECRET,
      oidcIssuer:   process.env.CSS_OIDC_ISSUER || CSS_URL,
    });
    return new PodClient({ podRoot: CSS_URL, auth: new SolidOidcAuth({ vault: sv }) });
  }

  it('share grants read on the storage-layout URI → resolveSharedRef resolves; revoke → null', async () => {
    const client = await makeClient();

    // Content lives in a memory store (the composition that exists); the ACP gate is live.
    const registry = { validate: () => ({ ok: true }) };
    const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
    const item = await stores.getStore('A').put({ type: 'task', text: 'secret plan' });

    // Point the resolver at the scratch container so the owner can write the ACP target.
    const resolver = sharedRefResourceUri(makeResourceUriResolver({ podUri: `${CSS_URL}${scratch}` }));

    const seam = makeCircleShareEnforcement({
      sharing: client.sharing, resourceUriFor: resolver, recipient: grantee,
    });

    // The ACP target must exist before Universal Access can set an agent grant on it.
    const targetUri = resolver({ sourceCircle: 'A', sourceId: item.id, sourceType: 'task' });
    await client.write(targetUri, 'placeholder', { contentType: 'text/plain', force: true });

    // WRITE side: share into circle B; the injected hook grants `grantee` read on `targetUri` for real.
    const shared = await shareIntoAudience(stores, {
      itemId: item.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice', recipient: grantee, onShare: seam.onShare,
    });
    expect(shared.ok).toBe(true);

    // READ side (grant present): the live ACP gate accepts → resolves to the memory source item.
    const got = await resolveSharedRef(stores, shared.ref, { policy: seam.policy });
    expect(got?.text).toBe('secret plan');

    // Revoke → the same gate now denies → null (deny-by-default, no ciphertext/content leak).
    await client.sharing.revoke({ resourceUri: targetUri, agent: grantee });
    expect(await resolveSharedRef(stores, shared.ref, { policy: seam.policy })).toBeNull();

    await client.delete(targetUri).catch(() => {});
    await client.close();
  });
});

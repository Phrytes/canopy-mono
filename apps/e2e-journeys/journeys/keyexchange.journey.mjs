// J-keyexchange: cross-app scoped data/key access (6c) on the real substrate.
// Both sub-models, over the same per-resource key-custodian broker:
//   (a) SCOPED-KEY GRANT — the holder presents a res.read:<id> capability, the
//       broker wraps THAT resource's key to them, and they open it OFFLINE. A
//       wrong-resource / stolen / revoked token gets a key of NOTHING.
//   (b) PROXY — the app never holds a key: it proxies the open to the custodian
//       (companion role) over the relay and gets back PLAINTEXT only.
// The primitives are real (@canopy/pod-client/sealing resourceKeyGrant + core
// CapabilityToken) — no new crypto. Design: plans/NOTE-folio-key-exchange.md.
import { Agent, AgentIdentity, Parts, DataPart } from '@canopy/core';
import { VaultMemory }        from '@canopy/vault';
import { RelayTransport }     from '@canopy/transports';
import { createResourceKeyGrant, openGrantedResource, generateKeypair } from '@canopy/pod-client/sealing';
import { wait, checker }      from './_util.mjs';

export const name = 'J-keyexchange (scoped cross-app key access + proxy)';

export async function run({ relayUrl }) {
  const { results, check } = checker();

  // The custodian = the companion/host that owns folio's data. It seals resources
  // under per-resource CEKs it retains, and is the broker for both sub-models.
  const hostId = await AgentIdentity.generate(new VaultMemory());
  const broker = createResourceKeyGrant({ identity: hostId });
  const ALBUM = 'album/2026-summer', NOTES = 'notes/kluis';
  const ALBUM_TEXT = 'photos: strand, bbq, kinderen';
  const NOTES_TEXT = 'de kluis-code is 4931';
  const { sealed: albumSealed } = broker.sealResource(ALBUM, ALBUM_TEXT);
  const { sealed: notesSealed } = broker.sealResource(NOTES, NOTES_TEXT);
  const ciphertext = { [ALBUM]: albumSealed, [NOTES]: notesSealed };  // host-blind bodies

  const annId = await AgentIdentity.generate(new VaultMemory());
  const ann  = new Agent({ identity: annId, transport: new RelayTransport({ relayUrl, identity: annId }) });
  const host = new Agent({ identity: hostId, transport: new RelayTransport({ relayUrl, identity: hostId }) });
  const annSeal  = generateKeypair();   // Ann's sealing keypair (receives a wrapped CEK in model a)
  const hostSeal = generateKeypair();   // the host opens on Ann's behalf in model b

  try {
    // ══ (a) SCOPED-KEY GRANT — the app decrypts one resource locally ═══════════
    const albumGrant = await broker.issueGrant({ subject: ann.address, resourceId: ALBUM });
    const rel = await broker.releaseKey({ token: albumGrant.toJSON(), requesterPubKey: ann.address, resourceId: ALBUM, requesterSealPubKey: annSeal.publicKey });
    const opened = rel.wrappedKey ? await openGrantedResource({ wrappedKey: rel.wrappedKey, sealPrivateKey: annSeal.privateKey, sealed: albumSealed }) : null;
    check('(a) holder gets a scoped per-resource key + opens the resource offline', opened === ALBUM_TEXT);

    const wrong = await broker.releaseKey({ token: albumGrant.toJSON(), requesterPubKey: ann.address, resourceId: NOTES, requesterSealPubKey: annSeal.publicKey });
    check('(a) the SAME grant cannot unlock a different resource (per-resource isolation)', wrong.denied === true && wrong.reason === 'wrong-scope');

    const eve = await AgentIdentity.generate(new VaultMemory());
    const noTok = await broker.releaseKey({ token: null, requesterPubKey: eve.pubKey, resourceId: ALBUM, requesterSealPubKey: generateKeypair().publicKey });
    check('(a) a non-holder gets NO key', noTok.denied === true);

    const bob = await AgentIdentity.generate(new VaultMemory());
    const stolen = await broker.releaseKey({ token: albumGrant.toJSON(), requesterPubKey: bob.pubKey, resourceId: ALBUM, requesterSealPubKey: generateKeypair().publicKey });
    check('(a) a stolen grant presented by another peer is DENIED (subject-binding)', stolen.denied === true && stolen.reason === 'subject-mismatch');

    await broker.revoke(albumGrant.id);
    const afterRevoke = await broker.releaseKey({ token: albumGrant.toJSON(), requesterPubKey: ann.address, resourceId: ALBUM, requesterSealPubKey: annSeal.publicKey });
    check('(a) after REVOKE, the same grant yields no key', afterRevoke.denied === true && afterRevoke.reason === 'revoked');

    // ══ (b) PROXY — the app never holds a key; the custodian opens + returns text ═
    // The host exposes a proxy-open: it verifies the caller's grant via the broker,
    // opens the resource with ITS OWN sealing key, and returns PLAINTEXT — the CEK
    // never crosses to the app.
    host.register('resource.proxyOpen', async (ctx) => {
      const caller = ctx?.originFrom ?? ctx?.from;
      const { token, resourceId } = Parts.data(ctx?.parts) ?? {};
      const r = await broker.releaseKey({ token, requesterPubKey: caller, resourceId, requesterSealPubKey: hostSeal.publicKey });
      if (r.denied) return [DataPart({ denied: true, reason: r.reason })];
      const plaintext = await openGrantedResource({ wrappedKey: r.wrappedKey, sealPrivateKey: hostSeal.privateKey, sealed: ciphertext[resourceId] });
      return [DataPart({ plaintext })];
    });
    ann.addPeer(host.address, host.address);
    host.addPeer(ann.address, ann.address);
    await ann.start(); await host.start(); await wait(1500);
    check('(b) app + custodian on the relay', ann.transport.connected && host.transport.connected);

    const notesGrant = await broker.issueGrant({ subject: ann.address, resourceId: NOTES });
    const proxied = Parts.data(await ann.invoke(host.address, 'resource.proxyOpen', [DataPart({ token: notesGrant.toJSON(), resourceId: NOTES })], { timeout: 9000 }));
    check('(b) proxy returns PLAINTEXT (custodian opened it)', proxied?.plaintext === NOTES_TEXT);
    check('(b) the app holds NO key — the response carries only plaintext, no CEK', !!proxied?.plaintext && !('wrappedKey' in (proxied ?? {})) && !('cek' in (proxied ?? {})));

    // An unauthorized token (Ann's ALBUM grant — wrong resource, and revoked) is denied at the proxy.
    const badProxy = Parts.data(await ann.invoke(host.address, 'resource.proxyOpen', [DataPart({ token: albumGrant.toJSON(), resourceId: NOTES })], { timeout: 9000 }));
    check('(b) an unauthorized proxy-open is DENIED (no plaintext)', badProxy?.denied === true && !badProxy?.plaintext);
  } finally {
    await ann.transport.disconnect().catch(() => {});
    await host.transport.disconnect().catch(() => {});
  }
  return results;
}

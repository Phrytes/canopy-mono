// mandateResource.test.js — G20/#31: the ENTRUST mandate's `resource` kind, end to
// end on the PROVEN substrate (no new crypto).
//
// A resource mandate is just a new CALLER of the scoped key-access machinery:
// `buildMandateGrant` mints a per-grain `res.read:<id>` capability that rides the
// SAME resourceKeyGrant / CapabilityToken verify path the keyexchange journey
// proves (9/9). This test mirrors that journey's assertions — happy path + wrong-scope / subject-mismatch / non-holder /
// revoked denials — but reached THROUGH the mandate issue path (TaskGrantManager
// .attachGrant, exactly what the `attachTaskGrant` op calls).
import { describe, it, expect } from 'vitest';
import {
  buildMandateGrant, resourceScope, resourceUseRequiresConsent,
  DEFAULT_RESOURCE_USE,
} from '../../src/v2/mandate.js';
import { AgentIdentity, TaskGrantManager } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  createResourceKeyGrant, openGrantedResource, generateKeypair,
  resourceScope as podResourceScope,
} from '@onderling/pod-client/sealing';

const AGENDA = 'agenda-2026';
const NOTES  = 'notes-kluis';
const AGENDA_TEXT = 'afspraak: tandarts di 10:00';

// Mint a mandate `resource` grant into a real cap-token via the SAME path the
// `attachTaskGrant` op uses: TaskGrantManager.attachGrant (direct issue, no parent
// — exactly how tasks-v0 constructs the manager). The granter's identity is BOTH
// the token issuer AND the resourceKeyGrant custodian (device-broker model): keys
// never leave the granter.
async function issueMandate({ granter, holderPubKey, grant, taskId = 'task-1' }) {
  const mgr = new TaskGrantManager({ identity: granter });
  return mgr.attachGrant({ taskId, memberPubKey: holderPubKey, grant });
}

describe('resource mandate — scope-string drift guard (mandate.js ≡ pod-client)', () => {
  it('item grain matches @onderling/pod-client sealing resourceScope byte-for-byte', () => {
    expect(resourceScope({ grain: 'item', id: AGENDA })).toBe(podResourceScope(AGENDA));
    expect(resourceScope({ id: AGENDA })).toBe(podResourceScope(AGENDA));          // item is the default
  });

  it('list grain is the container/path form res.read:/list/<id>/', () => {
    // The list grain is a container scope (trailing-slash prefix form). Its
    // per-item coverage is container-prefix semantics — NOT the exact/dot-wildcard
    // `offeringMatches` the item grain rides. Same res.read: contract as pod-client.
    expect(resourceScope({ grain: 'list', id: 'album' })).toBe(podResourceScope('/list/album/'));
  });
});

describe('resource mandate — use-consent ladder (consent-on-use)', () => {
  it('requestable (default) requires a fresh per-use consent; standing does not', () => {
    expect(resourceUseRequiresConsent('requestable')).toBe(true);
    expect(resourceUseRequiresConsent('standing')).toBe(false);
    expect(resourceUseRequiresConsent(undefined)).toBe(true);                       // default = requestable
    expect(DEFAULT_RESOURCE_USE).toBe('requestable');
  });

  it('buildMandateGrant carries the chosen use-consent into the grant constraints', () => {
    expect(buildMandateGrant({ kind: 'resource', scope: AGENDA }).constraints.use).toBe('requestable');
    expect(buildMandateGrant({ kind: 'resource', scope: AGENDA, use: 'standing' }).constraints.use).toBe('standing');
  });
});

describe('resource mandate — end to end on resourceKeyGrant (mirrors J-keyexchange)', () => {
  it('the rightful holder opens the resource; wrong-scope / subject-mismatch / non-holder / revoked are DENIED', async () => {
    // The granter's device: token issuer AND key custodian (device broker).
    const granter    = await AgentIdentity.generate(new VaultMemory());
    const broker     = createResourceKeyGrant({ identity: granter });
    const { sealed: agendaSealed } = broker.sealResource(AGENDA, AGENDA_TEXT);
    broker.sealResource(NOTES, 'de kluis-code is 4931');

    const holder     = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();

    // The mandate: item grain, device broker, requestable consent (the defaults).
    const grant = buildMandateGrant({ kind: 'resource', scope: AGENDA });
    const token = await issueMandate({ granter, holderPubKey: holder.pubKey, grant });

    // The mint is a per-grain res.read:<id> capability — NOT '*' + constraints.pod.
    expect(token.skill).toBe(resourceScope({ id: AGENDA }));
    expect(token.subject).toBe(holder.pubKey);

    // Happy path — the holder unwraps THIS resource's key and opens it offline.
    const rel = await broker.releaseKey({
      token: token.toJSON(), requesterPubKey: holder.pubKey,
      resourceId: AGENDA, requesterSealPubKey: holderSeal.publicKey,
    });
    expect(rel.wrappedKey).toBeTruthy();
    const opened = await openGrantedResource({
      wrappedKey: rel.wrappedKey, sealPrivateKey: holderSeal.privateKey, sealed: agendaSealed,
    });
    expect(opened).toBe(AGENDA_TEXT);

    // Wrong-scope — the SAME grant cannot unlock a different resource.
    const wrong = await broker.releaseKey({
      token: token.toJSON(), requesterPubKey: holder.pubKey,
      resourceId: NOTES, requesterSealPubKey: holderSeal.publicKey,
    });
    expect(wrong.denied).toBe(true);
    expect(wrong.reason).toBe('wrong-scope');

    // Subject-mismatch — a stolen grant presented by another peer is denied.
    const thief = await AgentIdentity.generate(new VaultMemory());
    const stolen = await broker.releaseKey({
      token: token.toJSON(), requesterPubKey: thief.pubKey,
      resourceId: AGENDA, requesterSealPubKey: generateKeypair().publicKey,
    });
    expect(stolen.denied).toBe(true);
    expect(stolen.reason).toBe('subject-mismatch');

    // Non-holder — no token, no key.
    const noTok = await broker.releaseKey({
      token: null, requesterPubKey: thief.pubKey,
      resourceId: AGENDA, requesterSealPubKey: generateKeypair().publicKey,
    });
    expect(noTok.denied).toBe(true);

    // Revoked — after revoke, the same grant yields no key (revoke-on-complete
    // rides this on the real path).
    await broker.revoke(token.id);
    const afterRevoke = await broker.releaseKey({
      token: token.toJSON(), requesterPubKey: holder.pubKey,
      resourceId: AGENDA, requesterSealPubKey: holderSeal.publicKey,
    });
    expect(afterRevoke.denied).toBe(true);
    expect(afterRevoke.reason).toBe('revoked');
  });
});

describe('resource mandate — LIST grain container coverage on resourceKeyGrant (G20 follow-up)', () => {
  // The list grain grants ONE container capability `res.read:/list/<id>/` that must
  // cover EVERY item at-or-below it (each item is sealed under its own per-item CEK).
  // The item grain rides exact `offeringMatches`; this rides the shared prefix-strict
  // path rule (PodCapabilityToken's `pathScopeCovers`), wired at the scope gate. Same
  // deny-by-default assertions as the item grain (mirrors J-keyexchange), but for a
  // whole-list grant: covers items IN the container; denies an item OUTSIDE it, a
  // WRONG list, a look-alike sibling list, a non-holder, a subject-mismatch, a revoke.
  const ALBUM      = 'album';
  const ITEM_1     = '/list/album/item-1';
  const ITEM_5     = '/list/album/item-5';
  const OTHER_ITEM = '/list/other/item-1';        // a DIFFERENT list — outside the container
  const LOOKALIKE  = '/list/albumX/item-9';       // prefix-strict trap: NOT under `/list/album/`
  const ITEM_5_TXT = 'foto: strand, juli 2026';

  it('a whole-list grant COVERS its items; item-outside / wrong-list / look-alike / non-holder / subject-mismatch / revoked are DENIED', async () => {
    const granter = await AgentIdentity.generate(new VaultMemory());
    const broker  = createResourceKeyGrant({ identity: granter });

    // Each list item is sealed under its OWN per-item CEK (the broker holds them all).
    const { sealed: item5Sealed } = broker.sealResource(ITEM_5, ITEM_5_TXT);
    broker.sealResource(ITEM_1, 'foto: bergen, juni 2026');
    broker.sealResource(OTHER_ITEM, 'geheim uit een andere lijst');
    broker.sealResource(LOOKALIKE, 'geheim uit een look-alike lijst');

    const holder     = await AgentIdentity.generate(new VaultMemory());
    const holderSeal = generateKeypair();

    // The mandate: LIST grain → a container scope `res.read:/list/album/` (not per-item).
    const grant = buildMandateGrant({ kind: 'resource', scope: ALBUM, grain: 'list' });
    const token = await issueMandate({ granter, holderPubKey: holder.pubKey, grant });
    expect(token.skill).toBe(resourceScope({ grain: 'list', id: ALBUM }));   // res.read:/list/album/
    expect(token.skill).toBe(podResourceScope('/list/album/'));               // pod-client parity
    expect(token.subject).toBe(holder.pubKey);

    // Happy path — the ONE list grant unwraps an item AT-OR-BELOW the container.
    const rel5 = await broker.releaseKey({
      token: token.toJSON(), requesterPubKey: holder.pubKey,
      resourceId: ITEM_5, requesterSealPubKey: holderSeal.publicKey,
    });
    expect(rel5.wrappedKey).toBeTruthy();
    const opened5 = await openGrantedResource({
      wrappedKey: rel5.wrappedKey, sealPrivateKey: holderSeal.privateKey, sealed: item5Sealed,
    });
    expect(opened5).toBe(ITEM_5_TXT);

    // …and a SECOND item under the same container is covered by the same grant.
    const rel1 = await broker.releaseKey({
      token: token.toJSON(), requesterPubKey: holder.pubKey,
      resourceId: ITEM_1, requesterSealPubKey: holderSeal.publicKey,
    });
    expect(rel1.wrappedKey).toBeTruthy();

    // Item in a WRONG list — outside the container → denied.
    const wrongList = await broker.releaseKey({
      token: token.toJSON(), requesterPubKey: holder.pubKey,
      resourceId: OTHER_ITEM, requesterSealPubKey: holderSeal.publicKey,
    });
    expect(wrongList.denied).toBe(true);
    expect(wrongList.reason).toBe('wrong-scope');

    // Look-alike sibling `/list/albumX/…` — prefix-strict boundary → NOT covered.
    const lookAlike = await broker.releaseKey({
      token: token.toJSON(), requesterPubKey: holder.pubKey,
      resourceId: LOOKALIKE, requesterSealPubKey: holderSeal.publicKey,
    });
    expect(lookAlike.denied).toBe(true);
    expect(lookAlike.reason).toBe('wrong-scope');

    // Subject-mismatch — a stolen list grant presented by another peer is denied.
    const thief  = await AgentIdentity.generate(new VaultMemory());
    const stolen = await broker.releaseKey({
      token: token.toJSON(), requesterPubKey: thief.pubKey,
      resourceId: ITEM_5, requesterSealPubKey: generateKeypair().publicKey,
    });
    expect(stolen.denied).toBe(true);
    expect(stolen.reason).toBe('subject-mismatch');

    // Non-holder — no token, no key.
    const noTok = await broker.releaseKey({
      token: null, requesterPubKey: thief.pubKey,
      resourceId: ITEM_5, requesterSealPubKey: generateKeypair().publicKey,
    });
    expect(noTok.denied).toBe(true);

    // Revoked — after revoke, the whole-list grant yields no key for ANY item.
    await broker.revoke(token.id);
    const afterRevoke = await broker.releaseKey({
      token: token.toJSON(), requesterPubKey: holder.pubKey,
      resourceId: ITEM_5, requesterSealPubKey: holderSeal.publicKey,
    });
    expect(afterRevoke.denied).toBe(true);
    expect(afterRevoke.reason).toBe('revoked');
  });
});

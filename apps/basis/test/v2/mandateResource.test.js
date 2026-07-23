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
    // The list grain is a K2 container scope (trailing-slash prefix form). Its
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

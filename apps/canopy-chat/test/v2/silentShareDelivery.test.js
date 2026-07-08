/**
 * SILENT out-of-circle DELIVERY (Frits' call) — the silent share must not just SEAL a copy, it must DELIVER it:
 * push the sealed copy over the relay directly to the recipient's peer, and the recipient's app receives it into
 * a "shared with me" list it can OPEN with its own network-derived sealing key.
 *
 * This proves the full loop with REAL sealing crypto (a recipient opens, a stranger does not):
 *   • the silent branch SENDS a `{subtype:'shared-copy', sealed, itemMeta, from}` envelope to the recipient's
 *     peer ADDRESS (= their published network key) via an injected mock relay sender,
 *   • makeHandleSharedCopy (the inbound peer handler) lands the received copy in a shared-with-me store,
 *   • the SHARED `buildSharedWithMe` selector projects the rows both shells render, and
 *   • `openSharedCopy` opens the copy with the recipient's real sealing key; a stranger's key throws (no leak).
 *
 * Harness mirrors circleShareOutOfCirclePolicy.test.js (the notify-track test is left untouched). Only the
 * SILENT branch of shareItemToPublishedKey is exercised.
 */
import { describe, it, expect, vi } from 'vitest';
import nacl from 'tweetnacl';
import {
  generateKeypair, generateGroupKey, recipientStrategy, groupKeyStrategy, isSealed,
  sealingPublicKeyFromNetworkKey, sealingKeyPairFromNetworkKey,
} from '@canopy/pod-client/sealing';
import { sealItem } from '@canopy/item-store';
import { makeCircleLists } from '@canopy/kring-host/circleLists';
import { buildCircleShareEnforcement } from '../../src/v2/circleShareEnforcement.js';
import { shareItemToPublishedKey } from '../../src/v2/circleShare.js';
import { createSharedWithMeStore } from '../../src/v2/sharedWithMeStore.js';
import { makeHandleSharedCopy } from '../../src/core/handlers/sharedCopyReceive.js';
import { buildSharedWithMe, openSharedCopy } from '../../src/v2/sharedWithMe.js';

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const flush = () => new Promise((r) => setTimeout(r, 5));

function fakeNetworkIdentity() {
  const kp = nacl.sign.keyPair();
  return { publicKey: b64u(kp.publicKey), secretKey: b64u(kp.secretKey) };
}

function fakeSharing() {
  const table = new Map();
  const key = (uri) => { if (!table.has(uri)) table.set(uri, new Set()); return table.get(uri); };
  return {
    table,
    has: (uri, agent) => key(uri).has(agent),
    async grant({ resourceUri, agent }) { key(resourceUri).add(agent); return { resourceUri, agent }; },
    async revoke({ resourceUri, agent }) { key(resourceUri).delete(agent); return { resourceUri, agent }; },
    async list({ resourceUri, agentsToQuery = [] }) {
      const set = key(resourceUri);
      return agentsToQuery.filter((a) => set.has(a)).map((agent) => ({ subject: 'agent', agent, modes: ['read'] }));
    },
  };
}

function memKeyStore(initial = null) {
  let stored = initial;
  return { read: async () => stored, write: async (r) => { stored = r; }, current: () => stored };
}

const POD = 'https://pod.example/';
// The injected pod-layer sealer the `silent` path needs (mirror of what the shells inject).
const sealCopyToRecipients = (item, keys) => sealItem(item, (t) => recipientStrategy({ recipients: keys }).seal(t));

function world({ roster, keyStore = memKeyStore(), controllerKey = generateKeypair(), alice = generateKeypair() } = {}) {
  const svc = makeCircleLists();
  const sharing = fakeSharing();
  const enforcement = buildCircleShareEnforcement({
    sharing,
    strategy: { open: groupKeyStrategy({ groupKey: generateGroupKey() }).open },
    podRoot: POD,
    controlAgent: { keyStore, members: () => (roster ?? [alice.publicKey]).map((publicKey) => ({ publicKey })) },
    idKey: { publicKey: controllerKey.publicKey, privateKey: controllerKey.privateKey },
  });
  return { svc, sharing, keyStore, resolveService: async () => svc, enforcementFor: async () => enforcement };
}

const silentArgs = (svc, extra) => ({
  resolveService: async () => svc,
  policyOf: () => ({ shareOutOfCircle: 'silent' }),
  sealCopy: sealCopyToRecipients,
  sealingKeyFromNetworkKey: sealingPublicKeyFromNetworkKey,
  ...extra,
});

describe('SILENT out-of-circle delivery — send over relay + shared-with-me receive', () => {
  it('SENDS a shared-copy to the recipient peer, the receiver stores it, and the recipient opens it', async () => {
    const { svc, resolveService, enforcementFor } = world();
    const dave = fakeNetworkIdentity();
    const src = await svc.createList('A', 'secret plan', 'alice');

    const sent = [];
    const sendSharedCopy = vi.fn(async (to, env) => { sent.push({ to, env }); });

    const r = await shareItemToPublishedKey({
      ...silentArgs(svc), resolveService, enforcementFor, sendSharedCopy,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    });
    expect(r.ok).toBe(true);

    // SEND: exactly one shared-copy envelope to dave's peer ADDRESS (his published network key).
    expect(sendSharedCopy).toHaveBeenCalledTimes(1);
    expect(sent[0].to).toBe(dave.publicKey);
    expect(sent[0].env.subtype).toBe('shared-copy');
    expect(sent[0].env.from).toBe('alice');
    expect(sent[0].env.itemMeta).toMatchObject({ sourceCircle: 'A', sharedCopyOf: src.id, silent: true });
    // The copy on the wire is SEALED (no plaintext leak on the relay).
    expect(isSealed(sent[0].env.sealed.text)).toBe(true);
    expect(sent[0].env.sealed.text).not.toContain('secret plan');

    // RECEIVE on dave's device: the inbound peer handler lands the copy in dave's shared-with-me store.
    let stored = [];
    const store = createSharedWithMeStore({ load: async () => stored, save: async (v) => { stored = v; } });
    const handle = makeHandleSharedCopy({ store });
    handle(dave.publicKey, sent[0].env);          // (fromAddr, payload) — the router's positional call
    await flush();

    const received = await store.list();
    expect(received).toHaveLength(1);

    // The SHARED selector projects the row both shells render.
    const rows = buildSharedWithMe(received);
    expect(rows).toHaveLength(1);
    expect(rows[0].sharedCopyOf).toBe(src.id);
    expect(rows[0].from).toBe('alice');

    // OPEN with REAL sealing crypto: dave derives his private sealing key from his network identity.
    const daveSealing = sealingKeyPairFromNetworkKey(dave.secretKey);
    const daveOpen = (t) => recipientStrategy({ privateKey: daveSealing.privateKey }).open(t);
    const opened = await openSharedCopy(rows[0], daveOpen);
    expect(opened.text).toBe('secret plan');

    // A stranger's key throws on the foreign envelope — deny-safe, no ciphertext returned.
    const eve = generateKeypair();
    const eveOpen = (t) => recipientStrategy({ privateKey: eve.privateKey }).open(t);
    await expect(openSharedCopy(rows[0], eveOpen)).rejects.toBeTruthy();
  });

  it('delivers even with NO toCircleId (pure person-share) — the pointer path is optional, the relay send is not', async () => {
    const { svc, resolveService, enforcementFor } = world();
    const dave = fakeNetworkIdentity();
    const src = await svc.createList('A', 'body', 'alice');
    const sendSharedCopy = vi.fn(async () => {});

    const r = await shareItemToPublishedKey({
      ...silentArgs(svc), resolveService, enforcementFor, sendSharedCopy,
      itemId: src.id, fromCircleId: 'A', by: 'alice',      // NO toCircleId
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    });
    expect(r.ok).toBe(true);
    expect(sendSharedCopy).toHaveBeenCalledTimes(1);
    expect(sendSharedCopy.mock.calls[0][0]).toBe(dave.publicKey);
    expect(sendSharedCopy.mock.calls[0][1].subtype).toBe('shared-copy');
  });

  it('the share still SUCCEEDS when no sender is injected (delivery degrades to pointer-only, no throw)', async () => {
    const { svc, resolveService, enforcementFor } = world();
    const dave = fakeNetworkIdentity();
    const src = await svc.createList('A', 'body', 'alice');
    const r = await shareItemToPublishedKey({
      ...silentArgs(svc), resolveService, enforcementFor,        // no sendSharedCopy
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    });
    expect(r.ok).toBe(true);
  });

  it('a relay send failure never fails the (already sealed + granted) share', async () => {
    const { svc, resolveService, enforcementFor } = world();
    const dave = fakeNetworkIdentity();
    const src = await svc.createList('A', 'body', 'alice');
    const sendSharedCopy = vi.fn(async () => { throw new Error('relay down'); });
    const r = await shareItemToPublishedKey({
      ...silentArgs(svc), resolveService, enforcementFor, sendSharedCopy,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    });
    expect(r.ok).toBe(true);
    expect(sendSharedCopy).toHaveBeenCalledTimes(1);
  });

  it('the shared-with-me store is idempotent on redelivery (dedupe by copy id)', async () => {
    let stored = [];
    const store = createSharedWithMeStore({ load: async () => stored, save: async (v) => { stored = v; } });
    const handle = makeHandleSharedCopy({ store });
    const env = { subtype: 'shared-copy', sealed: { id: 'copy-1', text: 'x' }, itemMeta: { copyId: 'copy-1', sourceType: 'note' }, from: 'alice' };
    handle('addr', env); await flush();
    handle('addr', env); await flush();     // redelivered
    expect(await store.list()).toHaveLength(1);
    expect(buildSharedWithMe(await store.list())[0].sourceType).toBe('note');
  });
});

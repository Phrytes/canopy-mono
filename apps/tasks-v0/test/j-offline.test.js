/**
 * J-offline — the offline-delivery JOURNEY on the reusable partition harness.
 *
 * The full "reach an away device" loop, hermetic + end-to-end:
 *
 *   Ann messages Bob whose device is AWAY (partitioned) → the message lands in
 *   Bob's companion SEALED INBOX (sealed in transit + at rest) → the reliable
 *   wake fires (alert-push + mutable-content, CONTENTLESS) → Bob's device
 *   RECONNECTS → DRAINS the inbox → OPENS with his key → gets the message. NO
 *   LOSS, and NO PLAINTEXT ever at the inbox.
 *
 * REUSE (not reimplementation):
 *   • `PartitionController` from the tasks-v0 partition harness models Bob's
 *     device being away vs reconnected (the same away/heal seam the claim-under-
 *     partition journey uses).
 *   • the REAL companion sealed inbox (`apps/companion-node/src/sealedInbox.js`).
 *   • the REAL sealing crypto (`@canopy/pod-client/sealing`) — Ann seals, only
 *     Bob (key-holder) opens; the inbox never decrypts.
 *   • the REAL reliable-wake sender (`@canopy/relay` `ReliableExpoPushSender`) —
 *     we assert the on-the-wire wake body is alert + mutable-content + contentless.
 */
import { describe, it, expect } from 'vitest';

import { PartitionController } from './harness/partitionSim.js';
import { createSealedInbox, MemorySealedInboxStore } from '../../companion-node/src/sealedInbox.js';
import { seal, open, generateKeypair } from '@canopy/pod-client/sealing';
import { ReliableExpoPushSender } from '@canopy/relay';

const ANN = 'https://id.example/ann';
const BOB = 'https://id.example/bob';

/** A mock Expo endpoint that records every push body the reliable sender posts. */
function recordingFetch() {
  const bodies = [];
  const fn = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, statusText: 'OK', text: async () => '{}', json: async () => ({ data: { status: 'ok' } }) };
  };
  fn.bodies = bodies;
  return fn;
}

describe('J-offline — hold → wake → reconnect → drain → deliver (no loss, sealed throughout)', () => {
  it('Ann→away-Bob lands sealed in the companion inbox; reconnect drains + decrypts; wake is reliable + contentless', async () => {
    // ── Setup: the away/reconnect seam + Bob's companion inbox + his key. ──────
    const controller = new PartitionController();
    const bobKey = generateKeypair();                       // Bob alone holds the private key
    const fetchFn = recordingFetch();
    const wakeSender = new ReliableExpoPushSender({ fetch: fetchFn });   // the RELIABLE path

    const inbox = createSealedInbox({
      store:  new MemorySealedInboxStore(),
      notify: async () => { await wakeSender.send('tok-bob', { wake: true, hint: 'message-pending' }, { platform: 'ios' }); },
    });

    // The ladder decision, as the node makes it: if Bob's device is away, the
    // message goes to the DURABLE inbox (+ wake); if present, it delivers direct.
    const bobDeviceInbox = [];      // what Bob's device actually receives when online
    async function annMessagesBob(text, topic = 'dm') {
      const sealed = seal(text, [bobKey.publicKey]);        // sealed IN TRANSIT — Ann seals to Bob
      if (controller.isBlocked(ANN, BOB)) {
        return inbox.deposit(BOB, sealed, { topic });       // away → durable hold + reliable wake
      }
      bobDeviceInbox.push(sealed);                          // present → direct delivery
      return { ok: true, direct: true };
    }

    // ── Bob's device goes AWAY (partitioned). Ann sends two messages. ──────────
    controller.partition([ANN], [BOB]);
    await annMessagesBob('the meeting moved to 3pm');
    const dep2 = await annMessagesBob('bring the blue folder');
    expect(dep2.ok).toBe(true);
    expect(dep2.count).toBe(2);                             // both HELD (not lost, not delivered)
    expect(bobDeviceInbox).toHaveLength(0);                // nothing reached the away device

    // ── The wake is RELIABLE + CONTENTLESS, and BATCHED (one wake, not two). ───
    expect(fetchFn.bodies).toHaveLength(1);
    const wake = fetchFn.bodies[0];
    expect(wake.mutableContent).toBe(true);                // alert-push + mutable-content:1 → NSE
    expect(wake._contentAvailable).toBeUndefined();        // NOT the unreliable silent path
    expect(wake.data).toEqual({ wake: true, hint: 'message-pending' });   // contentless

    // ── SEALED at rest: the inbox holds only ciphertext — no plaintext leaks. ──
    const atRest = JSON.stringify(await inbox.store.snapshot());
    expect(atRest).not.toContain('meeting');
    expect(atRest).not.toContain('folder');
    expect(atRest).toContain('fp1:');                      // sealed-envelope sentinel

    // ── Bob RECONNECTS (heal) and DRAINS. Opaque items + one contentless digest.
    controller.heal();
    expect(controller.isBlocked(ANN, BOB)).toBe(false);
    const { items, digest } = await inbox.drain(BOB);
    expect(items).toHaveLength(2);
    expect(digest).toEqual({ count: 2, topics: ['dm'] });  // M1 batch → ONE digest, not N

    // ── Only Bob can OPEN. Full loop, NO LOSS. ────────────────────────────────
    const delivered = items.map((m) => open(m.sealed, bobKey.privateKey));
    expect(delivered).toEqual(['the meeting moved to 3pm', 'bring the blue folder']);

    // ── Drained, not duplicated: the inbox is empty; a re-send now goes direct.
    expect(await inbox.count(BOB)).toBe(0);
    const direct = await annMessagesBob('and Bob is back online');
    expect(direct.direct).toBe(true);
    expect(bobDeviceInbox).toHaveLength(1);
    expect(open(bobDeviceInbox[0], bobKey.privateKey)).toBe('and Bob is back online');
  });
});

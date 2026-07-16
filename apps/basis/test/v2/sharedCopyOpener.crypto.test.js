/**
 * sharedCopyOpener (SILENT out-of-circle delivery) — the RECIPIENT-side opener, end-to-end with REAL crypto.
 *
 * Proves the vertical slice that makes "open a received copy" actually DECRYPT: a copy sealed (SENDER side) to a
 * recipient's PUBLISHED network key opens via the RECIPIENT's own `AgentIdentity.sharedCopyOpener()` — through
 * the app-layer `openerForIdentity` bridge (the pod-client sealing adapter injected into the kernel's opener
 * seam) and the shared `openSharedCopy` walk. No cipher mocks: real `AgentIdentity`, real `@onderling/pod-client`
 * sealing, real item-store seal/unseal.
 *
 *   • ROUND-TRIP: seal a copy to `sealingPublicKeyFromNetworkKey(recipient.pubKey)` (exactly what the shell seals
 *     to at share time) → `openSharedCopy(entry, openerForIdentity(recipient))` returns the plaintext content.
 *   • WRONG IDENTITY DENIED: a different identity's opener throws on the foreign envelope ⇒ `openSharedCopy`
 *     rejects — never plaintext, never ciphertext (deny-safe).
 *   • ENCAPSULATION: the identity API returns a FUNCTION (the opener closure), not the raw secret/private key.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { recipientStrategy, sealingPublicKeyFromNetworkKey } from '@onderling/pod-client/sealing';
import { sealItem } from '@onderling/item-store';
import { openSharedCopy } from '../../src/v2/sharedWithMe.js';
import { openerForIdentity, deviceSharedCopyOpener } from '../../src/v2/sharedCopyOpener.js';

/** SENDER side — seal a copy's content to a recipient's network-derived SEALING public key (shell share path). */
async function sealCopyToNetworkKey(item, recipientNetworkKeyB64) {
  const sealKey = sealingPublicKeyFromNetworkKey(recipientNetworkKeyB64);
  return sealItem(item, (text) => recipientStrategy({ recipients: [sealKey] }).seal(text));
}

describe('sharedCopyOpener — receiver opens a sealed copy with its own network identity (REAL crypto)', () => {
  it('opens a copy sealed to the recipient\'s published network key (round-trip)', async () => {
    const recipient = await AgentIdentity.generate(new VaultMemory());
    // The sender seals to what they know: the recipient's PUBLISHED network key (`pubKey`).
    const sealed = await sealCopyToNetworkKey(
      { id: 'copy-1', type: 'note', text: 'geheime notitie', title: 'plan' },
      recipient.pubKey,
    );
    // Structural keys stay plaintext; content is ciphertext until opened.
    expect(sealed.type).toBe('note');
    expect(sealed.text.startsWith('fp1:')).toBe(true);

    const opener = openerForIdentity(recipient);
    expect(typeof opener).toBe('function');

    const opened = await openSharedCopy({ sealed }, opener);
    expect(opened.text).toBe('geheime notitie');
    expect(opened.title).toBe('plan');
    expect(opened.type).toBe('note');
  });

  it('DENIES a wrong identity — a stranger\'s opener throws, no plaintext leaks', async () => {
    const recipient = await AgentIdentity.generate(new VaultMemory());
    const stranger  = await AgentIdentity.generate(new VaultMemory());
    const sealed = await sealCopyToNetworkKey({ id: 'copy-2', type: 'note', text: 'privé' }, recipient.pubKey);

    const strangerOpener = openerForIdentity(stranger);
    await expect(openSharedCopy({ sealed }, strangerOpener)).rejects.toBeTruthy();
  });

  it('ENCAPSULATION — the identity opener API yields a function, never the raw secret/private key', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const opener = id.sharedCopyOpener(deviceSharedCopyOpener);
    expect(typeof opener).toBe('function');
    expect(opener).not.toBeInstanceOf(Uint8Array);
    expect(typeof opener).not.toBe('string');
    // openerForIdentity returns null (deny-safe no-op) when there is no identity.
    expect(openerForIdentity(null)).toBeNull();
  });
});

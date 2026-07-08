/**
 * SharedWithMeScreen (mobile) — the SILENT out-of-circle "shared with me" surface (invariant #2 web ≡ mobile).
 * Vitest can't render RN components, so this exercises the PORTABLE logic the RN screen renders over and proves:
 *   • the screen uses the SAME shared selector/opener web's view uses (`buildSharedWithMe` / `openSharedCopy`) —
 *     asserted by identity against the shared module (no mobile fork), and
 *   • the projection + REAL-crypto open work end-to-end: a projected row opens with the recipient's own sealing
 *     key and a stranger's key is denied.
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { recipientStrategy, sealingKeyPairFromNetworkKey, sealingPublicKeyFromNetworkKey } from '@canopy/pod-client/sealing';
import { sealItem } from '@canopy/item-store';
// The barrel exports the RN screen imports — prove they are the ONE shared source.
import { buildSharedWithMe as barrelBuild, openSharedCopy as barrelOpen } from '@canopy-app/canopy-chat';
import { buildSharedWithMe as sharedBuild, openSharedCopy as sharedOpen } from '../../canopy-chat/src/v2/sharedWithMe.js';

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('mobile shared-with-me screen — over the ONE shared selector (web ≡ mobile)', () => {
  it('re-exports the SAME selector + opener web uses (no mobile fork)', () => {
    expect(barrelBuild).toBe(sharedBuild);
    expect(barrelOpen).toBe(sharedOpen);
  });

  it('projects received copies newest-first with the row shape the RN screen renders', () => {
    const rows = barrelBuild([
      { id: 'a', sealed: { id: 'a', text: 'x' }, itemMeta: { sourceType: 'note', sharedCopyOf: 's1' }, from: 'alice', receivedAt: 100 },
      { id: 'b', sealed: { id: 'b', text: 'y' }, itemMeta: { sourceType: 'task', sharedCopyOf: 's2' }, from: 'bob', receivedAt: 300 },
      { nope: true },   // malformed — no sealed → dropped
    ]);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);   // newest-first
    expect(rows[0]).toMatchObject({ id: 'b', from: 'bob', sourceType: 'task', sharedCopyOf: 's2' });
  });

  it('opens a sealed row with the recipient network key; a stranger is denied', async () => {
    // Seal a copy to dave's network-derived sealing public key (the shell seals to this at share time).
    const kp = nacl.sign.keyPair();
    const dave = { publicKey: b64u(kp.publicKey), secretKey: b64u(kp.secretKey) };
    // Seal to dave's SEALING public key derived from his NETWORK public key (the exact key the shell seals to).
    const sealed = await sealItem({ id: 'copy-1', type: 'note', text: 'private note' },
      (t) => recipientStrategy({ recipients: [sealingPublicKeyFromNetworkKey(dave.publicKey)] }).seal(t));

    const [row] = barrelBuild([{ id: 'copy-1', sealed, itemMeta: { copyId: 'copy-1', sourceType: 'note' }, from: 'alice', receivedAt: 1 }]);

    const daveSealing = sealingKeyPairFromNetworkKey(dave.secretKey);
    const daveOpen = (t) => recipientStrategy({ privateKey: daveSealing.privateKey }).open(t);
    const opened = await barrelOpen(row, daveOpen);
    expect(opened.text).toBe('private note');

    const eveKp = nacl.sign.keyPair();
    const eveSealing = sealingKeyPairFromNetworkKey(b64u(eveKp.secretKey));
    const eveOpen = (t) => recipientStrategy({ privateKey: eveSealing.privateKey }).open(t);
    await expect(barrelOpen(row, eveOpen)).rejects.toBeTruthy();
  });
});

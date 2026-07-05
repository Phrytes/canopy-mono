/**
 * Scenario: identity/cloud-backup-recovery
 *
 * Story: alice has uploaded a CloudBackup using a passphrase she remembers
 * (no paper-stored BIP-39 phrase).  Her phone is lost.  On a fresh device
 * she enters the passphrase; CloudBackup.restore reconstructs the Bootstrap;
 * the new device reads the existing identity-pod via the recovered
 * Bootstrap and pairs itself, retiring the lost phone.  An auth-log
 * `pod-migrated` event records the recovery.
 *
 * Lab setup: a shared MockPod (canonical), a MemoryAdapter (cloud), and
 * a CloudBackup against both.  No mesh transports needed.
 *
 * Action:
 *   1. phone-1 generates Bootstrap, uploads to cloud, initialises pod,
 *      writes its device record.
 *   2. phone-2 (no vault, no mnemonic) calls CloudBackup.restore with
 *      just the passphrase, gets a fresh Bootstrap, and uses it to
 *      decrypt + read the pod's identity container.
 *   3. phone-2 pairs itself, retires phone-1, appends `pod-migrated`.
 *
 * Assertion:
 *   - restore returns a Bootstrap whose secret matches phone-1's.
 *   - phone-2 can decrypt the pod (proof the cloud-derived key is correct).
 *   - the recovery `pod-migrated` event lands in the auth-log.
 *   - manifest still verifies after the writes.
 */
import { describe, it, expect } from 'vitest';

import { Bootstrap, AgentIdentity, IdentityPodStore, IdentitySync, CloudBackup, MemoryAdapter } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

import { MockPod } from '../../../src/_harness/index.js';

const POD_ROOT       = 'https://alice.example/';
const PASSPHRASE     = 'correct horse battery staple';
const SYNC_INTERVAL  = 60_000;
// Test-only Argon2id cost; production callers must NOT override.
const FAST_ARGON     = { m: 1024, t: 1, p: 1 };

async function makeStack({ bootstrap, sharedPod, intervalMs = SYNC_INTERVAL }) {
  const vault    = new VaultMemory();
  const identity = await AgentIdentity.generate(vault);
  const store    = new IdentityPodStore({
    podClient: sharedPod, bootstrap, identity, podRoot: POD_ROOT,
  });
  const sync = new IdentitySync({
    vault, podStore: store, podClient: sharedPod, intervalMs,
  });
  return { vault, identity, bootstrap, store, sync };
}

describe('identity/cloud-backup-recovery', () => {
  it('phone-2 (recovered via CloudBackup.restore) restores from pod and retires phone-1', async () => {
    const sharedPod    = new MockPod();
    const cloudAdapter = new MemoryAdapter();

    // ── Phone-1: setup + cloud backup ───────────────────────────────────
    const { bootstrap: bootstrap1 } = Bootstrap.create();
    const phone1 = await makeStack({ bootstrap: bootstrap1, sharedPod });

    const cb1 = new CloudBackup({ adapter: cloudAdapter, argonOpts: FAST_ARGON });
    await cb1.upload({
      bootstrap: bootstrap1,
      passphrase: PASSPHRASE,
      hints: [{
        '@type': 'dw:RecoveryHint',
        method:  'cloud-passphrase',
        hint:    'Standard "correct horse battery staple" mnemonic',
        setupAt: '2026-04-28T10:00:00Z',
      }],
    });

    // Pod-side initial state.
    await phone1.store.init();
    const phone1Path = `devices/device-${bootstrap1.fingerprint(phone1.identity.pubKeyBytes)}.enc`;
    await phone1.store.writeResource(phone1Path, {
      '@type':                  'dw:Device',
      pubkey:                   phone1.identity.pubKey,
      label:                    'phone-1',
      pairedAt:                 '2026-04-28T10:00:00Z',
      retired:                  false,
      bootstrapKeyFingerprint:  bootstrap1.fingerprint(),
    });

    // ── Phone-1 is lost.  No mnemonic written down. ─────────────────────
    phone1.sync.stop();

    // ── Phone-2: cloud recovery ─────────────────────────────────────────
    // The user only has the passphrase.  No bootstrap, no vault on hand.
    const cb2 = new CloudBackup({ adapter: cloudAdapter, argonOpts: FAST_ARGON });
    const restored = await cb2.restore({ passphrase: PASSPHRASE });
    expect(restored.bootstrap).toBeInstanceOf(Bootstrap);
    expect(restored.hints).toHaveLength(1);
    expect(restored.hints[0].method).toBe('cloud-passphrase');

    // Restored bootstrap must produce the same fingerprint as phone-1's.
    expect(restored.bootstrap.fingerprint())
      .toBe(bootstrap1.fingerprint());

    const phone2 = await makeStack({ bootstrap: restored.bootstrap, sharedPod });

    // init() detects existing manifest and verifies it (the manifest was
    // signed by phone-1's AgentIdentity; verification only needs phone-1's
    // pubKey embedded in the manifest itself, which is plaintext TTL).
    const init2 = await phone2.store.init();
    expect(init2.created).toBe(false);
    expect(init2.verified).toBe(true);

    // Pull the existing device list within one sync interval.
    const stats = await phone2.sync.now({ priority: 'startup' });
    expect(stats.pulls).toBeGreaterThanOrEqual(1);

    // Direct check: phone-2 can decrypt phone-1's record.
    const phone1Record = await phone2.store.readResource(phone1Path);
    expect(phone1Record.label).toBe('phone-1');
    expect(phone1Record.retired).toBe(false);

    // ── Phone-2 pairs itself + retires phone-1 + appends auth event ─────
    const phone2Path = `devices/device-${restored.bootstrap.fingerprint(phone2.identity.pubKeyBytes)}.enc`;
    await phone2.store.writeResource(phone2Path, {
      '@type':                 'dw:Device',
      pubkey:                  phone2.identity.pubKey,
      label:                   'phone-2',
      pairedAt:                new Date().toISOString(),
      retired:                 false,
      bootstrapKeyFingerprint: restored.bootstrap.fingerprint(),
    });
    await phone2.store.writeResource(phone1Path, {
      ...phone1Record,
      retired:   true,
      retiredAt: new Date().toISOString(),
    });

    await phone2.store.appendAuthEvent({
      event:  'pod-migrated',
      actor:  phone2.identity.pubKey,
      target: phone1.identity.pubKey,
      at:     '2026-04-28T13:00:00Z',
      metadata: {
        reason:      'cloud-backup-recovery',
        fromDevice:  'phone-1',
        toDevice:    'phone-2',
        fingerprint: restored.bootstrap.fingerprint(),
      },
    });

    // ── Assertions ──────────────────────────────────────────────────────
    const v = await phone2.store.verifyManifest();
    expect(v.ok).toBe(true);

    const finalPhone1 = await phone2.store.readResource(phone1Path);
    const finalPhone2 = await phone2.store.readResource(phone2Path);
    expect(finalPhone1.retired).toBe(true);
    expect(finalPhone2.label).toBe('phone-2');

    const events = await phone2.store.readAuthLog('2026-04-28T13:30:00Z');
    const migrated = events.find((e) => e['dw:event'] === 'pod-migrated');
    expect(migrated).toBeTruthy();
    expect(migrated['dw:metadata']?.reason).toBe('cloud-backup-recovery');
    expect(migrated['dw:metadata']?.toDevice).toBe('phone-2');
    expect(typeof migrated['dw:signature']).toBe('string');
  });

  it('the wrong cloud passphrase cannot recover', async () => {
    const cloudAdapter = new MemoryAdapter();
    const { bootstrap } = Bootstrap.create();
    const cb = new CloudBackup({ adapter: cloudAdapter, argonOpts: FAST_ARGON });
    await cb.upload({ bootstrap, passphrase: PASSPHRASE });

    const cb2 = new CloudBackup({ adapter: cloudAdapter, argonOpts: FAST_ARGON });
    await expect(cb2.restore({ passphrase: 'wrong-passphrase' }))
      .rejects.toMatchObject({ code: 'CLOUD_BACKUP_DECRYPT_FAILED' });
  });
});

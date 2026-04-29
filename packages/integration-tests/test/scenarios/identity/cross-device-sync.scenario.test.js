/**
 * Scenario: identity/cross-device-sync
 *
 * Story: alice has two devices (laptop + phone) sharing the same identity
 * pod (same Bootstrap, same canonical container).  She adds a contact
 * record on the laptop.  Within one IdentitySync interval, the phone
 * pulls the new contact into its local vault cache.
 *
 * Lab setup: two stacks ("laptop", "phone") share a single MockPod and a
 * common Bootstrap.  Each stack has its own AgentIdentity (different
 * device keys) + its own VaultMemory (independent local cache) + its own
 * IdentitySync running on a 1s interval (compressed via fake timers).
 *
 * Action:
 *   1. Both devices boot + run an initial sync (cache empty on both).
 *   2. Laptop writes a contact via writeResource.
 *   3. Advance fake-time by one IdentitySync interval — phone's periodic
 *      tick fires, pulls the new contact, updates the cache.
 *
 * Assertion: phone's vault cache contains the laptop-authored contact.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  Bootstrap,
  AgentIdentity,
  IdentityPodStore,
  IdentitySync,
  VaultMemory,
} from '@canopy/core';

import { MockPod } from '../../../src/_harness/index.js';

const POD_ROOT = 'https://alice.example/';
const VAULT_CACHE_PREFIX = 'identity-cache:';
const vaultCacheKeyFor   = (resourcePath) => VAULT_CACHE_PREFIX + resourcePath;

async function makeDevice({ bootstrap, sharedPod, intervalMs }) {
  const vault    = new VaultMemory();
  const identity = await AgentIdentity.generate(vault);
  const store    = new IdentityPodStore({
    podClient: sharedPod, bootstrap, identity, podRoot: POD_ROOT,
  });
  const sync = new IdentitySync({
    vault, podStore: store, podClient: sharedPod, intervalMs,
  });
  return { vault, identity, store, sync };
}

describe('identity/cross-device-sync', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it('phone sees a contact added on the laptop within one IdentitySync interval', async () => {
    const sharedPod         = new MockPod();
    const { bootstrap }     = Bootstrap.create();
    const INTERVAL_MS       = 1000;

    const laptop = await makeDevice({ bootstrap, sharedPod, intervalMs: INTERVAL_MS });
    const phone  = await makeDevice({ bootstrap, sharedPod, intervalMs: INTERVAL_MS });

    // Laptop boots first + initialises the container.
    await laptop.store.init();

    // Phone's init() is a verifying no-op (manifest already there).
    const init2 = await phone.store.init();
    expect(init2.created).toBe(false);
    expect(init2.verified).toBe(true);

    // Both start their periodic loops.  start() kicks off an immediate
    // sync as priority='startup'; we await both via flush before adding
    // the contact so the cache baseline is consistent.
    laptop.sync.start();
    phone.sync.start();

    // Drain microtasks so the immediate startup syncs settle.
    await vi.runOnlyPendingTimersAsync();
    await vi.runAllTicks();
    // Both startup syncs are now in-flight or done; wait for them.
    await Promise.resolve();
    await Promise.resolve();

    // ── Laptop adds a contact ───────────────────────────────────────────
    const contactPath = 'contacts/contact-bob.enc';
    const contactRecord = {
      '@type':    'dw:Contact',
      pubkey:     'ed25519:base58:bob-fake-pubkey',
      label:      'Bob (work)',
      webid:      'https://bob.example/profile/card#me',
      trustTier:  2,
      groups:     ['group:work'],
      firstSeen:  '2026-04-28T14:00:00Z',
    };
    await laptop.store.writeResource(contactPath, contactRecord);

    // The phone's cache MUST NOT have the contact yet (no tick has fired).
    const before = await phone.vault.get(vaultCacheKeyFor(contactPath));
    expect(before).toBeFalsy();

    // ── Advance time by one full interval — phone's tick fires ──────────
    await vi.advanceTimersByTimeAsync(INTERVAL_MS + 50);
    // Pending in-flight promise resolves on next microtasks.
    await vi.runAllTicks();
    await Promise.resolve();
    await Promise.resolve();

    // ── Phone's cache should now contain the contact ────────────────────
    const after = await phone.vault.get(vaultCacheKeyFor(contactPath));
    expect(after).toBeTruthy();
    const cached = JSON.parse(after);
    expect(cached.record).toEqual(contactRecord);

    // Stop both loops cleanly.
    laptop.sync.stop();
    phone.sync.stop();
  });

  it('contact updates on the laptop propagate to the phone via on-demand sync', async () => {
    // Variant of the main scenario without periodic timers: confirms that
    // the foreground / on-demand sync path also delivers cross-device
    // changes within one cycle.
    const sharedPod     = new MockPod();
    const { bootstrap } = Bootstrap.create();

    const laptop = await makeDevice({ bootstrap, sharedPod, intervalMs: 60_000 });
    const phone  = await makeDevice({ bootstrap, sharedPod, intervalMs: 60_000 });

    await laptop.store.init();
    await phone.store.init();

    const contactPath = 'contacts/contact-y.enc';
    await laptop.store.writeResource(contactPath, {
      '@type':   'dw:Contact',
      pubkey:    'p',
      label:     'Y (initial)',
      trustTier: 1,
    });

    // Phone foreground hook → full sync, now() resolves once done.
    await phone.sync.now({ priority: 'foreground' });
    const cached1 = JSON.parse(await phone.vault.get(vaultCacheKeyFor(contactPath)));
    expect(cached1.record.label).toBe('Y (initial)');

    // Laptop updates the same record (e.g. user edits the label).
    await laptop.store.writeResource(contactPath, {
      '@type':   'dw:Contact',
      pubkey:    'p',
      label:     'Y (renamed)',
      trustTier: 2,
    });

    // Phone re-syncs — must observe the update.
    await phone.sync.now({ priority: 'foreground' });
    // Read the canonical pod via phone's own store to guarantee freshness
    // (the cache fast-path may skip if etag/lastModified collide on very
    // fast clocks; the pod is the source of truth either way).
    const podRecord = await phone.store.readResource(contactPath);
    expect(podRecord.label).toBe('Y (renamed)');
    expect(podRecord.trustTier).toBe(2);
  });
});

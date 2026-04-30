/**
 * BotIdentity unit tests.  No real pod, no filesystem — VaultMemory only.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory, AgentIdentity } from '@canopy/core';

import { BotIdentity } from '../../src/identity/BotIdentity.js';

const POD_ROOT = 'https://pod.example.com/bot/';

describe('BotIdentity', () => {
  it('throws if no vault is supplied', () => {
    expect(() => new BotIdentity({})).toThrow(/vault/);
  });

  it('pubkey and webid are null before load(); populated after', async () => {
    const bot = new BotIdentity({ vault: new VaultMemory(), botPodRoot: POD_ROOT });
    expect(bot.pubkey).toBeNull();
    expect(bot.webid).toBeNull();

    await bot.load();

    expect(typeof bot.pubkey).toBe('string');
    expect(bot.pubkey.length).toBeGreaterThan(20);
    expect(bot.webid).toBe('https://pod.example.com/bot/profile/card#me');
  });

  it('load() on a fresh vault generates a new keypair and persists it', async () => {
    const vault = new VaultMemory();
    const bot   = new BotIdentity({ vault, botPodRoot: POD_ROOT });

    expect(await vault.list()).toEqual([]);
    await bot.load();

    const keys = await vault.list();
    expect(keys).toContain('household-bot-identity-privkey');
    // Should NOT have stomped under the AgentIdentity-default key
    // (that would clash with another agent on a shared vault).
    expect(keys).not.toContain('agent-privkey');
  });

  it('load() on a vault with an existing keypair loads it (no regeneration)', async () => {
    const vault = new VaultMemory();

    // First boot: generate + remember pubkey.
    const first = new BotIdentity({ vault, botPodRoot: POD_ROOT });
    await first.load();
    const firstPub = first.pubkey;
    expect(firstPub).toBeTruthy();

    // Second boot on the SAME vault: should restore, not regenerate.
    const second = new BotIdentity({ vault, botPodRoot: POD_ROOT });
    await second.load();
    expect(second.pubkey).toBe(firstPub);
  });

  it('calling load() twice on the same instance returns the same pubkey', async () => {
    const bot = new BotIdentity({ vault: new VaultMemory(), botPodRoot: POD_ROOT });

    await bot.load();
    const pubAfterFirst = bot.pubkey;

    await bot.load();
    expect(bot.pubkey).toBe(pubAfterFirst);
  });

  it('sign() produces a signature verifiable via AgentIdentity.verify', async () => {
    const bot = new BotIdentity({ vault: new VaultMemory(), botPodRoot: POD_ROOT });
    await bot.load();

    const payload   = 'bot marked complete: item-42';
    const signature = await bot.sign(payload);

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(64); // Ed25519 detached.

    expect(AgentIdentity.verify(payload, signature, bot.pubkey)).toBe(true);
    // Tampered payload must fail.
    expect(AgentIdentity.verify('tampered', signature, bot.pubkey)).toBe(false);
  });

  it('sign() throws if called before load()', async () => {
    const bot = new BotIdentity({ vault: new VaultMemory(), botPodRoot: POD_ROOT });
    await expect(bot.sign('x')).rejects.toThrow(/load\(\)/);
  });

  it('webid follows <botPodRoot>/profile/card#me, with-or-without trailing slash', async () => {
    // Trailing slash.
    const a = new BotIdentity({ vault: new VaultMemory(), botPodRoot: 'https://x/bot/' });
    await a.load();
    expect(a.webid).toBe('https://x/bot/profile/card#me');

    // No trailing slash.
    const b = new BotIdentity({ vault: new VaultMemory(), botPodRoot: 'https://x/bot' });
    await b.load();
    expect(b.webid).toBe('https://x/bot/profile/card#me');
  });

  it('webid is null when no botPodRoot is supplied', async () => {
    const bot = new BotIdentity({ vault: new VaultMemory() });
    await bot.load();
    expect(bot.pubkey).toBeTruthy();
    expect(bot.webid).toBeNull();
  });

  it('exposes the underlying AgentIdentity for downstream consumers', async () => {
    const bot = new BotIdentity({ vault: new VaultMemory(), botPodRoot: POD_ROOT });
    expect(bot.agentIdentity).toBeNull();

    await bot.load();
    expect(bot.agentIdentity).toBeInstanceOf(AgentIdentity);
    expect(bot.agentIdentity.pubKey).toBe(bot.pubkey);
  });

  it('does not clash with another AgentIdentity sharing the same vault', async () => {
    // Sanity check: a sibling AgentIdentity using the default
    // 'agent-privkey' slot must remain independent of the bot's seed.
    const vault = new VaultMemory();

    const sibling = await AgentIdentity.generate(vault);
    const siblingPub = sibling.pubKey;

    const bot = new BotIdentity({ vault, botPodRoot: POD_ROOT });
    await bot.load();

    expect(bot.pubkey).not.toBe(siblingPub);

    // Reload the sibling — its key must be untouched by the bot's load().
    const restored = await AgentIdentity.restore(vault);
    expect(restored.pubKey).toBe(siblingPub);
  });
});

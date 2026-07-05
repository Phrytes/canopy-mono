/**
 * AdminCapability unit tests.  No real pod, no filesystem —
 * VaultMemory only.
 */
import { describe, it, expect } from 'vitest';
import { PodCapabilityToken } from '@canopy/core';
import { VaultMemory } from '@canopy/vault';

import { BotIdentity } from '../../src/identity/BotIdentity.js';
import {
  mintAdminCap,
  verifyAdminCap,
  rotateAdminCaps,
} from '../../src/identity/AdminCapability.js';

const POD_ROOT       = 'https://pod.example.com/bot/';
const OTHER_POD_ROOT = 'https://pod.example.com/someone-else/';

/** Test helper: a fully-loaded BotIdentity. */
async function makeBot(podRoot = POD_ROOT) {
  const bot = new BotIdentity({ vault: new VaultMemory(), botPodRoot: podRoot });
  await bot.load();
  return bot;
}

describe('AdminCapability', () => {
  describe('mintAdminCap', () => {
    it('produces a verifiable token', async () => {
      const bot = await makeBot();

      const { token, expiresAt } = await mintAdminCap({
        adminWebid:  'https://alice.example/profile/card#me',
        botPodRoot:  POD_ROOT,
        botIdentity: bot.agentIdentity,
      });

      expect(typeof token).toBe('string');
      expect(typeof expiresAt).toBe('number');
      expect(expiresAt).toBeGreaterThan(Date.now());

      const parsed = PodCapabilityToken.fromJSON(token);
      expect(PodCapabilityToken.verify(parsed, POD_ROOT)).toBe(true);
      expect(parsed.subject).toBe('https://alice.example/profile/card#me');
      expect(parsed.pod).toBe(POD_ROOT);
      expect(parsed.scopes).toContain('pod.*:/');
    });

    it('throws when required args are missing', async () => {
      const bot = await makeBot();

      await expect(mintAdminCap({})).rejects.toThrow(/adminWebid/);
      await expect(mintAdminCap({
        adminWebid: 'wid', botIdentity: bot.agentIdentity,
      })).rejects.toThrow(/botPodRoot/);
      await expect(mintAdminCap({
        adminWebid: 'wid', botPodRoot: POD_ROOT,
      })).rejects.toThrow(/botIdentity/);
    });

    it('honours expiresInMs', async () => {
      const bot = await makeBot();

      const before = Date.now();
      const { expiresAt } = await mintAdminCap({
        adminWebid:  'https://alice.example/profile/card#me',
        botPodRoot:  POD_ROOT,
        botIdentity: bot.agentIdentity,
        expiresInMs: 5_000,
      });
      const after = Date.now();

      // expiresAt = now + 5s, give or take the test's wall-clock drift.
      expect(expiresAt).toBeGreaterThanOrEqual(before + 5_000);
      expect(expiresAt).toBeLessThanOrEqual(after + 5_000);
    });
  });

  describe('verifyAdminCap', () => {
    it('accepts a freshly-minted token and returns the original adminWebid', async () => {
      const bot = await makeBot();

      const adminWebid = 'https://alice.example/profile/card#me';
      const { token, expiresAt } = await mintAdminCap({
        adminWebid,
        botPodRoot:  POD_ROOT,
        botIdentity: bot.agentIdentity,
      });

      const result = await verifyAdminCap({
        token,
        botPodRoot: POD_ROOT,
        botPubkey:  bot.pubkey,
      });

      expect(result).not.toBeNull();
      expect(result.webid).toBe(adminWebid);
      expect(result.expiresAt).toBe(expiresAt);
    });

    it('rejects an expired token', async () => {
      const bot = await makeBot();

      const { token } = await mintAdminCap({
        adminWebid:  'https://alice.example/profile/card#me',
        botPodRoot:  POD_ROOT,
        botIdentity: bot.agentIdentity,
        // Token is born already expired (1ms TTL, then sleep).
        expiresInMs: 1,
      });

      // Wait a tick to ensure Date.now() has crossed expiresAt.
      await new Promise(r => setTimeout(r, 5));

      const result = await verifyAdminCap({
        token,
        botPodRoot: POD_ROOT,
        botPubkey:  bot.pubkey,
      });
      expect(result).toBeNull();
    });

    it('rejects a token issued for a different pod', async () => {
      const bot = await makeBot();

      const { token } = await mintAdminCap({
        adminWebid:  'https://alice.example/profile/card#me',
        botPodRoot:  POD_ROOT,
        botIdentity: bot.agentIdentity,
      });

      const result = await verifyAdminCap({
        token,
        botPodRoot: OTHER_POD_ROOT,
        botPubkey:  bot.pubkey,
      });
      expect(result).toBeNull();
    });

    it('rejects a token signed by a different (rotated-out) bot key', async () => {
      const oldBot = await makeBot();
      const newBot = await makeBot();
      expect(newBot.pubkey).not.toBe(oldBot.pubkey);

      const { token } = await mintAdminCap({
        adminWebid:  'https://alice.example/profile/card#me',
        botPodRoot:  POD_ROOT,
        botIdentity: oldBot.agentIdentity,
      });

      // Verifying against the NEW bot's pubkey should fail — the
      // old token was signed by the old key.
      const result = await verifyAdminCap({
        token,
        botPodRoot: POD_ROOT,
        botPubkey:  newBot.pubkey,
      });
      expect(result).toBeNull();
    });

    it('rejects garbage / malformed tokens', async () => {
      const bot = await makeBot();

      expect(await verifyAdminCap({
        token: 'not json',
        botPodRoot: POD_ROOT,
        botPubkey:  bot.pubkey,
      })).toBeNull();

      expect(await verifyAdminCap({
        token: '{"id":"x"}', // missing fields
        botPodRoot: POD_ROOT,
        botPubkey:  bot.pubkey,
      })).toBeNull();

      // Wrong-shape args.
      expect(await verifyAdminCap({})).toBeNull();
    });
  });

  describe('rotateAdminCaps', () => {
    it('produces N tokens for N admins (skipping non-admins)', async () => {
      const bot = await makeBot();

      const household = {
        members: [
          { webid: 'wid:alice', role: 'admin'  },
          { webid: 'wid:bob',   role: 'member' },
          { webid: 'wid:carol', role: 'admin'  },
          { webid: 'wid:dan',   role: 'guest'  },
        ],
      };

      const caps = await rotateAdminCaps({ household, botIdentity: bot });

      expect(caps).toHaveLength(2);
      expect(caps.map(c => c.adminWebid).sort()).toEqual(['wid:alice', 'wid:carol']);

      // Each minted cap must verify.
      for (const cap of caps) {
        const result = await verifyAdminCap({
          token:       cap.token,
          botPodRoot:  POD_ROOT,
          botPubkey:   bot.pubkey,
        });
        expect(result).not.toBeNull();
        expect(result.webid).toBe(cap.adminWebid);
      }
    });

    it('returns an empty array when there are no admins', async () => {
      const bot = await makeBot();
      const household = {
        members: [
          { webid: 'wid:bob', role: 'member' },
          { webid: 'wid:dan', role: 'guest'  },
        ],
      };
      const caps = await rotateAdminCaps({ household, botIdentity: bot });
      expect(caps).toEqual([]);
    });

    it('throws if botIdentity has not been loaded', async () => {
      const unloaded = new BotIdentity({
        vault:      new VaultMemory(),
        botPodRoot: POD_ROOT,
      });
      await expect(rotateAdminCaps({
        household: { members: [{ webid: 'wid:alice', role: 'admin' }] },
        botIdentity: unloaded,
      })).rejects.toThrow(/loaded/);
    });

    it('throws if household.members is missing', async () => {
      const bot = await makeBot();
      await expect(rotateAdminCaps({
        household:   {},
        botIdentity: bot,
      })).rejects.toThrow(/members/);
    });
  });
});

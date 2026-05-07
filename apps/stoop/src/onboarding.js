/**
 * H5 onboarding (invite-link → group-token) — Phase 7 product item #2.
 *
 * Two skills + the spawn-on-redemption hook. Designed for the in-process
 * testbed (`bin/stoop-testbed.js`) that runs admin + N members in one
 * process over a shared bus, but the skills themselves don't depend on
 * the testbed — they just need a `core.GroupManager` for the admin
 * identity.
 *
 * The redemption flow:
 *   1. Admin's UI calls `issueInvite({groupId, ttlMs?, role?})` → invite token.
 *   2. Admin shares the invite link out-of-band (chat / DM / paper).
 *   3. New member opens the link in a browser tab pointed at the admin's
 *      mountLocalUi URL: `/onboard.html?invite=<token>`.
 *   4. The page generates a fresh AgentIdentity locally (V0: ephemeral, V1+
 *      will offer mnemonic-rooted), then POSTs to `/tasks/send` invoking
 *      `redeemInvite({invite, memberPubKey, displayName?})`. In a testbed
 *      setup, this skill ALSO calls the spawn hook to bring a new core.Agent
 *      online for the redeemed member; in a production setup, the new
 *      member's process holds its own agent and the skill just returns
 *      the proof.
 *   5. The page stores the returned proof and either redirects to the new
 *      agent's URL (testbed) or to the existing main UI (single-process).
 *
 * V0 trade-offs (locked per Project Files/coding-plans/H5-V2-product-items.md):
 *   - Identity bring-up: ephemeral keypair on join (V1+ adds mnemonic-restore).
 *   - Admin writes the new member into the in-memory `MemberMap` (production
 *     needs to write the pod-config; that's an app-layer DataSource adapter).
 *   - Single-use invite (nonce tracked in admin's vault).
 */
import { defineSkill } from '@canopy/core';

const DEFAULT_TTL_MS = 60 * 60 * 1000;        // 1 hour

/**
 * @typedef {(args: {webid, displayName, role}) => Promise<{
 *   identity:     import('@canopy/core').AgentIdentity,
 *   spawnedUrl?:  string,
 * }>} OnSpawnHook
 *
 * The hook is called by `redeemInvite` BEFORE the actual proof is minted —
 * it must generate (or restore) the member's identity and bring up
 * whatever runtime state belongs in the spawn (in-process testbed: a new
 * core.Agent + UI; production: just generate-and-return the identity, the
 * proof gets bundled into the response and the new member's separate
 * process imports it).
 */

/**
 * Build the onboarding skills.
 *
 * @param {object} args
 * @param {import('@canopy/core').GroupManager} args.groupManager
 * @param {import('@canopy/identity-resolver').MemberMap} args.members
 * @param {string} args.groupId
 * @param {OnSpawnHook} [args.onSpawn]   optional spawn-and-mint-identity hook (testbed)
 * @returns {Array<object>}              array of `defineSkill` definitions
 */
export function buildOnboardingSkills({ groupManager, members, groupId, onSpawn }) {
  if (!groupManager) throw new TypeError('buildOnboardingSkills: groupManager required');
  if (!members)      throw new TypeError('buildOnboardingSkills: members (MemberMap) required');
  if (typeof groupId !== 'string' || !groupId) {
    throw new TypeError('buildOnboardingSkills: groupId required');
  }

  return [
    /**
     * issueInvite({ttlMs?, role?}) → {invite}
     * Admin-only via the LocalUiAuth-configured actor; the role-policy
     * gate above us is at the item-store layer, not here, so apps that
     * want strict admin-only semantics can sandbox this skill behind
     * a separate transport or check `from` themselves.
     */
    defineSkill('issueInvite', async ({ parts }) => {
      const a = dataArgs(parts);
      const ttlMs = Number.isFinite(a.ttlMs) ? a.ttlMs : DEFAULT_TTL_MS;
      const role  = a.role ?? 'member';
      const invite = await groupManager.issueInvite(groupId, { expiresIn: ttlMs, role });
      return { invite };
    }, {
      description: 'Issue a single-use group invite token (admin-only).',
      visibility:  'authenticated',
    }),

    /**
     * redeemInvite({invite, displayName?, webid?, memberPubKey?})
     *   → {groupProof, memberPubKey, webid, displayName, members, spawnedUrl?}
     *
     * Two flows:
     *  - **Testbed/in-process** (when an `onSpawn` hook is wired): the
     *    skill generates a fresh AgentIdentity via the hook, redeems the
     *    invite for that pubKey, spawns the new member's runtime in the
     *    same process, returns its `spawnedUrl`. The browser doesn't
     *    need to do any crypto.
     *  - **Production** (no hook, separate-process member): the new
     *    member's process generates its own identity beforehand and
     *    passes `memberPubKey` in. The skill mints + returns the proof;
     *    the calling process imports it.
     */
    defineSkill('redeemInvite', async ({ parts }) => {
      const a = dataArgs(parts);
      if (!a.invite) return { error: 'invite required' };

      // Pre-validate the invite so spawn doesn't run on a bogus token.
      if (!(await groupManager.verifyInvite(a.invite))) {
        return { error: 'invalid or expired invite' };
      }

      const role        = a.invite.role ?? 'member';
      const webid       = a.webid       ?? null;
      const displayName = a.displayName ?? webid?.split('/').pop() ?? null;

      let memberPubKey = a.memberPubKey ?? null;
      let spawnedUrl;

      if (onSpawn) {
        // Testbed flow — generate identity + spawn agent THEN redeem.
        let spawn;
        try {
          spawn = await onSpawn({
            webid:       webid ?? `urn:onboard:${Math.random().toString(36).slice(2, 10)}`,
            displayName: displayName ?? 'New member',
            role,
          });
        } catch (err) {
          return { error: `spawn failed: ${err?.message ?? err}` };
        }
        memberPubKey = spawn.identity.pubKey;
        spawnedUrl   = spawn.spawnedUrl;
      } else if (!memberPubKey) {
        return { error: 'memberPubKey required (no spawn hook configured)' };
      }

      let proof;
      try {
        proof = await groupManager.redeemInvite(a.invite, memberPubKey);
      } catch (err) {
        return { error: err?.message ?? 'redemption failed' };
      }

      const finalWebid       = webid       ?? `urn:pubkey:${memberPubKey}`;
      const finalDisplayName = displayName ?? finalWebid.split(':').pop().slice(0, 12);

      await members.addMember({
        webid:       finalWebid,
        displayName: finalDisplayName,
        role:        proof.role,
        pubKey:      memberPubKey,
      });

      const allMembers = await members.list();
      return {
        groupProof: proof,
        memberPubKey,
        webid:       finalWebid,
        displayName: finalDisplayName,
        members:     allMembers,
        ...(spawnedUrl ? { spawnedUrl } : {}),
      };
    }, {
      description: 'Redeem an invite for a new member; mints + persists a GroupProof.',
      // V0 localhost-trust: anyone who reaches the admin's localhost can
      // redeem a valid invite. Real auth (cap-token-in-cookie) lives in V1.
      visibility:  'public',
    }),
  ];
}

function dataArgs(parts) {
  if (!Array.isArray(parts)) return {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

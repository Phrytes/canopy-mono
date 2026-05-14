/**
 * multiCrewOnboarding — Tasks V2 multi-crew runtime (2026-05-14).
 *
 * `buildOnboardingSkills` in `@canopy/identity-resolver` is per-
 * crew: its closure captures `groupManager`, `members`, `groupId`,
 * `onSpawn` once. Registering it from `createCrewAgent` for each
 * crew would silently last-write-wins the global skill registry,
 * dropping all but the latest crew's GroupManager.
 *
 * This wrapper registers `issueInvite` + `redeemInvite` ONCE against
 * the meshAgent. Each call resolves the right CrewState from
 * `bundleResolver` and reads the per-crew GroupManager + MemberMap
 * + onSpawn hook that `createCrewAgent` stashed on it.
 *
 * Wire it from `bin/tasks-ui.js --multi-crew` AFTER `wireSkills` so
 * the rest of the skill surface is already registered.
 */

import { defineSkill } from '@canopy/core';

const DEFAULT_TTL_MS = 60 * 60 * 1000;

function dataArgs(parts) {
  if (!Array.isArray(parts)) return {};
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? {};
}

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 *   Resolves a CrewState from skill args. The CrewState must expose
 *   `groupManager`, `members`, and `crewIdForOnboarding` (set in
 *   `createCrewAgent` when the crew is built — including the
 *   multi-crew `wireOnboardingSkills: false` path).
 * @returns {Array<object>}
 */
export function buildMultiCrewOnboardingSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildMultiCrewOnboardingSkills: bundleResolver required');
  }

  return [
    /**
     * issueInvite({crewId, ttlMs?, role?}) → {invite}
     *
     * Multi-crew variant: `crewId` is mandatory for routing. The
     * resolved CrewState supplies the per-crew GroupManager.
     */
    defineSkill('issueInvite', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew?.groupManager) return { error: 'crewId required' };
      const a = dataArgs(parts);
      const ttlMs = Number.isFinite(a.ttlMs) ? a.ttlMs : DEFAULT_TTL_MS;
      const role  = a.role ?? 'member';
      const groupId = crew.crewIdForOnboarding ?? crew.liveCrew?.crewId ?? crew.crewId;
      const invite = await crew.groupManager.issueInvite(groupId, { expiresIn: ttlMs, role });
      return { invite };
    }, {
      description: 'Multi-crew: issue a single-use invite for the routed crew (admin-only).',
      visibility:  'authenticated',
    }),

    /**
     * redeemInvite({invite, displayName?, webid?, memberPubKey?})
     *   → {groupProof, memberPubKey, webid, displayName, members,
     *      spawnedUrl?}
     *
     * Multi-crew variant: the invite carries the groupId; we look
     * the matching CrewState up via that. The routing arg `crewId`
     * is OPTIONAL — when omitted, we infer it from `invite.groupId`.
     */
    defineSkill('redeemInvite', async ({ parts, from, envelope }) => {
      const a = dataArgs(parts);
      if (!a.invite) return { error: 'invite required' };

      // Routing: caller may pass `crewId`; otherwise infer from the
      // invite payload. The resolver runs in two passes if the
      // caller didn't supply one — first with what they passed, then
      // (when that fails) with the invite's groupId.
      let crew = bundleResolver(parts, { envelope, from });
      if (!crew?.groupManager) {
        const groupIdFromInvite = a.invite?.groupId ?? null;
        if (groupIdFromInvite) {
          // Synthesize parts with the inferred crewId so the
          // bundleResolver picks the right CrewState.
          const synthParts = [
            { type: 'DataPart', data: { ...a, crewId: groupIdFromInvite } },
          ];
          crew = bundleResolver(synthParts, { envelope, from });
        }
      }
      if (!crew?.groupManager) return { error: 'crewId required (no matching crew)' };

      if (!(await crew.groupManager.verifyInvite(a.invite))) {
        return { error: 'invalid or expired invite' };
      }

      const role        = a.invite.role ?? 'member';
      const webid       = a.webid       ?? null;
      const displayName = a.displayName ?? webid?.split('/').pop() ?? null;

      let memberPubKey = a.memberPubKey ?? null;
      let spawnedUrl;

      const onSpawn = crew.onSpawn ?? null;
      if (onSpawn) {
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
        proof = await crew.groupManager.redeemInvite(a.invite, memberPubKey);
      } catch (err) {
        return { error: err?.message ?? 'redemption failed' };
      }

      const finalWebid       = webid       ?? `urn:pubkey:${memberPubKey}`;
      const finalDisplayName = displayName ?? finalWebid.split(':').pop().slice(0, 12);

      await crew.members.addMember({
        webid:       finalWebid,
        displayName: finalDisplayName,
        role:        proof.role,
        pubKey:      memberPubKey,
      });

      // Phase 52.9.3 sub-slice 4 (2026-05-14) — live peer-roster
      // update. Tell the substrate-mirror about the new peer so the
      // next addTask fan-out reaches them. Best-effort (the local
      // member-map update above is the source of truth; the mirror
      // roster is a downstream cache for fan-out routing).
      if (typeof crew.tasksMirror?.addPeer === 'function') {
        try { await crew.tasksMirror.addPeer(memberPubKey); } catch { /* swallow */ }
      }

      const allMembers = await crew.members.list();
      return {
        groupProof: proof,
        memberPubKey,
        webid:       finalWebid,
        displayName: finalDisplayName,
        members:     allMembers,
        ...(spawnedUrl ? { spawnedUrl } : {}),
      };
    }, {
      description: 'Multi-crew: redeem an invite — routes by args.crewId or invite.groupId.',
      visibility:  'public',
    }),
  ];
}

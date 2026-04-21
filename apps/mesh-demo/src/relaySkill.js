/**
 * relaySkill — Group C.
 *
 * Registers the 'relay-forward' skill on an agent, enabling it to act as a
 * cooperative relay hop for trusted peers.
 *
 * The skill is opt-in: controlled by agent.config's policy.allowRelayFor field.
 *   'never'    — skill returns an error (SDK default)
 *   'trusted'  — only relay for peers at trust tier ≥ 1
 *   'group:X'  — only relay for members of group X
 *   'always'   — relay for any caller (dev/testing only)
 *
 * No imports from @canopy/react-native — safe to test in Node.js.
 */
import { Parts, DataPart, TIER_LEVEL } from '@canopy/core';

/**
 * Register the relay-forward skill on the given agent.
 * Call this once during agent setup (after createAgent()).
 *
 * @param {import('@canopy/core').Agent} agent
 */
export function registerRelaySkill(agent) {
  agent.register('relay-forward', async ({ parts, from }) => {

    // ── Policy / trust check ───────────────────────────────────────────────
    const policy = agent.config?.get('policy.allowRelayFor') ?? 'never';

    if (policy === 'never') {
      return [DataPart({ error: 'relay-not-enabled' })];
    }

    if (policy === 'trusted') {
      // 'trusted' requires explicit elevation (tier 2).
      // The default after hello is 'authenticated' (tier 1), so 'trusted' means
      // the app has explicitly called trustRegistry.setTier(pubKey, 'trusted').
      const tierName  = await agent.trustRegistry?.getTier(from) ?? 'public';
      const tierLevel = TIER_LEVEL[tierName] ?? 0;
      if (tierLevel < TIER_LEVEL.trusted) {
        return [DataPart({ error: 'relay-denied: trust tier too low' })];
      }
    }

    if (policy?.startsWith('group:')) {
      const groupId = policy.slice('group:'.length);
      const hasProof = await agent.security?.groupManager?.hasValidProof(from, groupId) ?? false;
      if (!hasProof) {
        return [DataPart({ error: `relay-denied: not a member of group ${groupId}` })];
      }
    }
    // 'always' → skip all checks (dev/testing only)

    // ── Input validation ───────────────────────────────────────────────────
    const d = Parts.data(parts);
    if (!d?.targetPubKey) return [DataPart({ error: 'missing targetPubKey' })];
    if (!d?.skill)        return [DataPart({ error: 'missing skill' })];

    // ── Reachability check ─────────────────────────────────────────────────
    const record = await agent.peers?.get(d.targetPubKey);
    if (!record || !record.reachable) {
      return [DataPart({ error: 'target-unreachable' })];
    }

    // Refuse to relay to the caller itself (loop guard)
    if (d.targetPubKey === from) {
      return [DataPart({ error: 'relay-loop: target is the caller' })];
    }

    // ── Forward ────────────────────────────────────────────────────────────
    try {
      const result = await agent.invoke(
        d.targetPubKey,
        d.skill,
        Parts.wrap(d.payload ?? []),
        { timeout: d.timeout ?? 10_000 },
      );
      // Encode the full parts array inside the DataPart so TextParts survive the hop.
      return [DataPart({ forwarded: true, parts: result })];
    } catch (err) {
      return [DataPart({ error: `forward-failed: ${err.message}` })];
    }
  }, {
    visibility:  'authenticated',
    description: 'Relay a message to an indirectly reachable peer (opt-in, trust-gated)',
  });
}

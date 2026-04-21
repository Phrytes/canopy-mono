/**
 * relayForward — cooperative relay skill.
 *
 * Registers the 'relay-forward' skill on an agent, letting trusted peers ask
 * us to forward a task to a third peer we can reach directly. Drives the
 * hop-routing behaviour used by invokeWithHop.
 *
 * The skill is opt-in: the `policy` option (or `agent.config.policy.allowRelayFor`)
 * decides who may call it. See EXTRACTION-PLAN.md §4 for tier semantics.
 *
 *   'never'         — skill returns an error (safe default in core)
 *   'authenticated' — caller must have completed a hello (has a key in SecurityLayer)
 *   'trusted'       — caller must hold trust tier ≥ 'trusted' (explicit TrustRegistry elevation)
 *   'group:X'       — caller must hold a valid GroupProof for group X
 *   'always'        — any caller (dev/testing only)
 */
import { Parts, DataPart } from '../Parts.js';
import { TIER_LEVEL }      from '../permissions/TrustRegistry.js';

/**
 * Register the relay-forward skill on the given agent.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} [opts]
 * @param {'never'|'authenticated'|'trusted'|`group:${string}`|'always'} [opts.policy]
 *        If omitted, falls back to `agent.config.get('policy.allowRelayFor')`
 *        and then to 'never'.
 */
export function registerRelayForward(agent, opts = {}) {
  const policyOverride = opts.policy;

  agent.register('relay-forward', async ({ parts, from }) => {

    // ── Resolve the policy ───────────────────────────────────────────────────
    const policy = policyOverride ?? agent.config?.get?.('policy.allowRelayFor') ?? 'never';

    // ── Policy check ─────────────────────────────────────────────────────────
    if (policy === 'never') {
      return [DataPart({ error: 'relay-not-enabled' })];
    }

    if (policy === 'authenticated') {
      // Any peer we've completed a hello with qualifies.
      if (!agent.security?.getPeerKey?.(from)) {
        return [DataPart({ error: 'relay-denied: not authenticated' })];
      }
    } else if (policy === 'trusted') {
      const tierName  = await agent.trustRegistry?.getTier?.(from) ?? 'public';
      const tierLevel = TIER_LEVEL[tierName] ?? 0;
      if (tierLevel < TIER_LEVEL.trusted) {
        return [DataPart({ error: 'relay-denied: trust tier too low' })];
      }
    } else if (typeof policy === 'string' && policy.startsWith('group:')) {
      const groupId  = policy.slice('group:'.length);
      const hasProof = await agent.security?.groupManager?.hasValidProof?.(from, groupId) ?? false;
      if (!hasProof) {
        return [DataPart({ error: `relay-denied: not a member of group ${groupId}` })];
      }
    }
    // 'always' → no check.

    // ── Input validation ─────────────────────────────────────────────────────
    const d = Parts.data(parts);
    if (!d?.targetPubKey) return [DataPart({ error: 'missing targetPubKey' })];
    if (!d?.skill)        return [DataPart({ error: 'missing skill' })];

    // ── Reachability check ───────────────────────────────────────────────────
    const record = await agent.peers?.get?.(d.targetPubKey);
    if (!record || !record.reachable) {
      return [DataPart({ error: 'target-unreachable' })];
    }

    // Refuse to relay to the caller itself (loop guard).
    if (d.targetPubKey === from) {
      return [DataPart({ error: 'relay-loop: target is the caller' })];
    }

    // ── Forward ──────────────────────────────────────────────────────────────
    try {
      const result = await agent.invoke(
        d.targetPubKey,
        d.skill,
        Parts.wrap(d.payload ?? []),
        { timeout: d.timeout ?? 10_000, origin: from },
      );
      // Encode the full parts array inside the DataPart so TextParts survive the hop.
      return [DataPart({ forwarded: true, parts: result })];
    } catch (err) {
      return [DataPart({ error: `forward-failed: ${err?.message ?? err}` })];
    }
  }, {
    visibility:  'authenticated',
    description: 'Relay a message to an indirectly reachable peer (opt-in, policy-gated)',
  });
}

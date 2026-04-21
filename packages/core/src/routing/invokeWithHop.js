/**
 * invokeWithHop — hop-aware invoke.
 *
 * Pure routing primitive, no platform deps. See EXTRACTION-PLAN.md §7 Group M.
 *
 * Strategy:
 *   1. If the PeerGraph record explicitly marks this peer as indirect
 *      (hops > 0), skip the direct attempt.
 *   2. Otherwise try agent.invoke() directly.
 *      - On a "pubKey" security error, attempt agent.hello() and retry once.
 *      - On a skill error (not transport, not security), re-throw — don't
 *        mask genuine handler errors with a bridge retry.
 *   3. If direct failed with a transport error (or we skipped it), look for
 *      bridge peers in order:
 *        a) record.via (the peer that gossiped the target to us)
 *        b) every other reachable direct peer
 *      Each candidate that can't reach the target fails fast with
 *      `target-unreachable` or `Unknown skill: relay-forward`; we skip and
 *      try the next.
 *   4. Ask the bridge's `relay-forward` skill to forward. If `data.forwarded`
 *      is set, return the inner parts; otherwise return the raw parts array.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string}  targetPubKey
 * @param {string}  skillId
 * @param {Array}   [parts]
 * @param {object}  [opts]
 * @param {number}  [opts.timeout=10000]
 * @returns {Promise<Array>}
 */
import { DataPart, Parts } from '../Parts.js';

const TRANSPORT_ERROR_KEYWORDS = [
  'not connected', 'no connection', 'timeout', 'offline', 'unreachable',
  'no route', 'not reachable',
];

function isTransportError(message = '') {
  const lower = message.toLowerCase();
  return TRANSPORT_ERROR_KEYWORDS.some(keyword => lower.includes(keyword));
}

function isMissingKeyError(message = '') {
  return /pubkey/i.test(message);
}

export async function invokeWithHop(agent, targetPubKey, skillId, parts = [], opts = {}) {
  const record     = await agent.peers?.get?.(targetPubKey);
  const skipDirect = (record?.hops ?? 0) > 0;

  // ── 1. Direct attempt ──────────────────────────────────────────────────────
  if (!skipDirect) {
    try {
      return await agent.invoke(targetPubKey, skillId, parts, opts);
    } catch (err) {
      const msg = err?.message ?? '';

      // Missing key means hello was never done (or was missed). Attempt hello
      // and retry once so the first message to a newly-discovered peer works.
      if (isMissingKeyError(msg)) {
        try {
          await agent.hello(targetPubKey, opts.helloTimeout ?? 10_000);
          return await agent.invoke(targetPubKey, skillId, parts, opts);
        } catch {
          // Hello failed — fall through to bridge logic.
        }
      } else if (!isTransportError(msg)) {
        // Genuine skill error — don't mask with a bridge retry.
        throw err;
      }
    }
  }

  // ── 2. Build bridge candidates ─────────────────────────────────────────────
  const bridges = [];
  if (record?.via) bridges.push(record.via);

  const allPeers = (await agent.peers?.all?.()) ?? [];
  for (const p of allPeers) {
    if (!p?.pubKey || p.pubKey === targetPubKey) continue;
    if ((p.hops ?? 0) !== 0)        continue;
    if (p.reachable === false)      continue;
    if (bridges.includes(p.pubKey)) continue;
    bridges.push(p.pubKey);
  }

  if (bridges.length === 0) {
    throw new Error(
      `No route to ${String(targetPubKey).slice(0, 12)}… ` +
      `— direct failed and no bridge peer available`,
    );
  }

  // ── 3. Try each bridge in order ───────────────────────────────────────────
  let lastErr;
  for (const viaPubKey of bridges) {
    try {
      const relayResult = await agent.invoke(
        viaPubKey,
        'relay-forward',
        [DataPart({ targetPubKey, skill: skillId, payload: parts, timeout: opts.timeout })],
        { timeout: (opts.timeout ?? 10_000) + 2_000 },
      );

      const data = Parts.data(relayResult);
      if (data?.error) {
        lastErr = new Error(`bridge ${viaPubKey.slice(0, 12)}… refused: ${data.error}`);
        continue;
      }
      if (data?.forwarded) return data.parts ?? [];
      return relayResult;
    } catch (err) {
      lastErr = new Error(`bridge ${viaPubKey.slice(0, 12)}… failed: ${err?.message ?? err}`);
    }
  }

  throw lastErr ?? new Error(`No working bridge to ${String(targetPubKey).slice(0, 12)}…`);
}

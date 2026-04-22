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
import { signOrigin }      from '../security/originSignature.js';
import { packSealed }      from '../security/sealedForward.js';

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
  // Order (de-duped):
  //   a. oracle hits — direct peers whose cached, fresh reachability claim
  //      contains the target. These are tried first so probe-retry never
  //      runs on the happy path (Group T, Design-v3 §6).
  //   b. record.via — the peer that gossiped this target to us.
  //   c. other reachable direct peers (classic probe-retry fallback).
  const allPeers = (await agent.peers?.all?.()) ?? [];
  const now      = Date.now();

  const oracleBridges = allPeers
    .filter(p => p?.pubKey && p.pubKey !== targetPubKey)
    .filter(p => (p.hops ?? 0) === 0)
    .filter(p => p.reachable !== false)
    .filter(p => Array.isArray(p.knownPeers) && p.knownPeers.includes(targetPubKey))
    .filter(p => typeof p.knownPeersTs === 'number' && p.knownPeersTs > now)
    .map(p => p.pubKey)
    .sort();      // deterministic order across oracle candidates

  const bridges = [...oracleBridges];

  if (record?.via && !bridges.includes(record.via)) {
    bridges.push(record.via);
  }

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

  // ── 3. Sign the origin claim once for all bridge attempts (Group Z) ──────
  // The bridge preserves (originSig, originTs) unchanged through its inner
  // invoke; the final-hop target verifies canonicalize({v:1, target, skill,
  // parts, ts}) against the origin pubkey. Re-using one sig across bridges
  // is safe: each bridge forwards the same body; the target's pubKey is the
  // same regardless of which bridge delivers it.
  let originSig   = null;
  let originTs    = null;
  if (agent.identity?.sign) {
    const signed = signOrigin(agent.identity, {
      target: targetPubKey,
      skill:  skillId,
      parts,
    });
    originSig = signed.sig;
    originTs  = signed.originTs;
  }

  // ── 4. Sealed-forward decision (Group BB) ────────────────────────────────
  // A send is sealed when EITHER:
  //   • opts.sealed === true (per-call override), OR
  //   • opts.group is set AND agent has enableSealedForwardFor(opts.group).
  // Direct delivery (step 1) already succeeded if that path worked, so by
  // the time we're here we know a bridge will be involved — which is when
  // content-privacy matters.
  const groupCfg = opts.group
    ? agent.getSealedForwardConfig?.(opts.group) ?? null
    : null;
  const useSealed = opts.sealed === true || !!groupCfg?.enabled;

  let sealedBlob = null;
  if (useSealed) {
    if (!agent.identity?.pubKey) {
      throw new Error('invokeWithHop: sealed forward requires an identity');
    }
    const { sealed, nonce } = packSealed({
      identity:        agent.identity,
      recipientPubKey: targetPubKey,
      skill:           skillId,
      parts,
      origin:          agent.pubKey,
      originSig,
      originTs,
    });
    sealedBlob = { sealed, nonce };
    agent.emit?.('sealed-forward-sent', {
      target: targetPubKey, skill: skillId, group: opts.group ?? null,
    });
  }

  // ── 5. Try each bridge in order ───────────────────────────────────────────
  let lastErr;
  for (const viaPubKey of bridges) {
    try {
      const relayPayload = sealedBlob
        ? {
            targetPubKey,
            sealed:  sealedBlob.sealed,
            nonce:   sealedBlob.nonce,
            timeout: opts.timeout,
          }
        : {
            targetPubKey,
            skill:     skillId,
            payload:   parts,
            timeout:   opts.timeout,
            originSig,
            originTs,
          };

      const relayResult = await agent.invoke(
        viaPubKey,
        'relay-forward',
        [DataPart(relayPayload)],
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

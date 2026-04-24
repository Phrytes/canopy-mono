/**
 * hopOneShot — fallback one-shot relay-forward for hop calls.
 *
 * Used when the chosen bridge does NOT advertise tunnel:true (Group CC)
 * or the caller forced opts.tunnel === false.  Drops streaming / IR
 * support — the bridge runs the skill, returns the terminal Parts in a
 * single round-trip via relay-forward.
 *
 * Sealed (Group BB) and plaintext variants share this entry point —
 * `sealedBlob` is non-null for the sealed path.
 *
 * Extracted from callWithHop.js for testability + readability.
 */
import { DataPart, Parts } from '../Parts.js';

/**
 * @param {import('../Agent.js').Agent} agent
 * @param {string} bridgePubKey
 * @param {string} targetPubKey
 * @param {string} skillId
 * @param {import('../Parts.js').Part[]} parts
 * @param {{ sealed: string, nonce: string }|null} sealedBlob
 * @param {string|null} originSig
 * @param {number|null} originTs
 * @param {object} opts
 * @returns {Promise<import('../Parts.js').Part[]>}
 */
export async function oneShotForward(
  agent, bridgePubKey, targetPubKey, skillId, parts,
  sealedBlob, originSig, originTs, opts,
) {
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
    bridgePubKey,
    'relay-forward',
    [DataPart(relayPayload)],
    { timeout: (opts.timeout ?? 10_000) + 2_000 },
  );

  const data = Parts.data(relayResult);
  if (data?.error)     throw new Error(data.error);
  if (data?.forwarded) return data.parts ?? [];
  return relayResult;
}

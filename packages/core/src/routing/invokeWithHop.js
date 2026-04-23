/**
 * invokeWithHop — Promise<Parts[]> facade over callWithHop.
 *
 * Thin wrapper that calls callWithHop (which returns a Task) and awaits
 * terminal so existing callers keep getting a Parts[] back.  All the
 * interesting logic — direct → bridge → tunnel-or-one-shot, origin
 * signing, sealed forwarding — lives in callWithHop.
 *
 * Preserves the pre-CC3 contract: throws on failure, returns parts on
 * success, no Task exposure.
 */
import { callWithHop } from './callWithHop.js';

/**
 * @param {import('../Agent.js').Agent} agent
 * @param {string}  targetPubKey
 * @param {string}  skillId
 * @param {Array}   [parts]
 * @param {object}  [opts]
 * @returns {Promise<Array>}
 */
export async function invokeWithHop(agent, targetPubKey, skillId, parts = [], opts = {}) {
  const task = callWithHop(agent, targetPubKey, skillId, parts, opts);
  const snap = await task.done();
  if (snap.state === 'failed')    throw new Error(snap.error ?? `Skill "${skillId}" failed via hop`);
  if (snap.state === 'cancelled') throw new Error(`Skill "${skillId}" cancelled`);
  if (snap.state === 'expired')   throw new Error(`Skill "${skillId}" expired`);
  return snap.parts ?? [];
}

export { callWithHop };

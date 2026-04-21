/**
 * skillDiscovery.js — query a peer's available skills.
 *
 * Uses RQ/RS so the caller gets a synchronous response.
 * The responder filters skills to the caller's trust tier.
 */

/** Marker type in RQ/RS payload */
const TYPE = 'skill-discovery';

/**
 * Request the skill list from a peer.
 * Returns a SkillCard[] filtered to the tier the peer thinks we're in.
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {string} peerId
 * @param {number} [timeout=10000]
 * @returns {Promise<Array<{id, description, inputModes, outputModes, tags, streaming}>>}
 */
export async function requestSkills(agent, peerId, timeout = 10_000) {
  const rs = await agent.transport.request(peerId, { type: TYPE }, timeout);
  return rs.payload?.skills ?? [];
}

/**
 * Handle an inbound skill-discovery RQ. Returns skills filtered to
 * the caller's trust tier (via TrustRegistry if available).
 *
 * @param {import('../Agent.js').Agent} agent
 * @param {object} envelope  — the RQ envelope
 */
export async function handleSkillDiscovery(agent, envelope) {
  if (envelope.payload?.type !== TYPE) return false;  // not our message

  // Determine trust tier for this peer.
  let tier = 'authenticated';
  if (agent.trustRegistry) {
    tier = await agent.trustRegistry.getTier(envelope._from) ?? 'authenticated';
  }

  // Per-caller filter: handles group-visible skills via agent.security.groupManager.
  const gm     = agent.security?.groupManager;
  const skills = (await agent.skills.forCaller({
    tier,
    callerPubKey: envelope._from,
    checkGroup:   gm ? (pk, gid) => gm.hasValidProof(pk, gid) : undefined,
  })).map(s => ({
    id:          s.id,
    description: s.description,
    inputModes:  s.inputModes,
    outputModes: s.outputModes,
    tags:        s.tags,
    streaming:   s.streaming,
  }));

  await agent.transport.respond(envelope._from, envelope._id, { type: TYPE, skills });
  return true;
}

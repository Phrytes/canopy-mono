/**
 * addBot — get a bot/contact into the app PeerGraph (feedback-extension P5).
 *
 * The Contacten roster reads the app-owned PeerGraph; this is how a bot GETS
 * there. Two inputs, both landing a record the roster + the P4 registry pick up:
 *
 *   - an **https URL** → REUSES core `discoverA2A(coreAgent, url, {peerGraph})`,
 *     which fetches the bot's `/.well-known/agent.json` agent card, upserts an
 *     `a2a` peer (skills become SkillCards → P4 commands), and — if the card
 *     carries `x-canopy.pubKey`+`peerAddr` — transparently upgrades to a native
 *     peer so the conversational channel reaches it over sa.peer (mdns/relay/nkn);
 *   - a **raw peer address** (NKN/pubKey, optionally `addr|Name`) → a manual
 *     `hybrid` upsert, for a peer-only bot with no HTTP card.
 *
 * Pure of any transport/DOM: deps are injected (`discover` = core `discoverA2A`,
 * `coreAgent` = the underlying chat agent `agent.sa.agent`), so web + mobile share
 * it and it's testable with a fake discover.
 */

/**
 * @param {object} deps
 * @param {string}  deps.input       an https URL or a peer address (`addr` | `addr|Name`).
 * @param {{ upsert: (rec: object) => Promise<object> }} deps.peerGraph  the app PeerGraph.
 * @param {object}  [deps.coreAgent] the core chat agent (for `discover`); required for URL input.
 * @param {(agent: object, url: string, opts: object) => Promise<object>} [deps.discover]
 *   core `discoverA2A`; required for URL input.
 * @returns {Promise<object>} the upserted peer record.
 */
export async function addBotToGraph({ input, peerGraph, coreAgent, discover } = {}) {
  const s = String(input ?? '').trim();
  if (!s) throw new Error('addBot: empty input');
  if (!peerGraph || typeof peerGraph.upsert !== 'function') {
    throw new Error('addBot: a PeerGraph with upsert() is required');
  }

  if (/^https?:\/\//i.test(s)) {
    if (typeof discover !== 'function') throw new Error('addBot: a `discover` (discoverA2A) is required for URL input');
    // discoverA2A upserts into peerGraph itself + returns the record.
    return discover(coreAgent, s, { peerGraph });
  }

  // Raw peer address (NKN/pubKey). Optional `addr|Display Name`.
  const [addr, ...rest] = s.split('|');
  const name = rest.join('|').trim();
  const cleanAddr = addr.trim();
  if (!cleanAddr) throw new Error('addBot: empty address');
  return peerGraph.upsert({ type: 'hybrid', pubKey: cleanAddr, name: name || cleanAddr, reachable: true });
}

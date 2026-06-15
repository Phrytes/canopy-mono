/**
 * contactsSource — the roster behind the Contacten tab (feedback-extension P5).
 *
 * Maps the agent's `PeerGraph` records into plain roster rows the contacts
 * screen renders, on BOTH web and mobile (pure: no DOM/RN). A "contact" here is
 * any known peer — a person (native) or a bot/agent (a2a/hybrid). Each row
 * carries what the roster + the DM thread need: a stable id, a display name, the
 * bot flag + skill count (so the P4 registry's commands can be surfaced in that
 * thread), reachability, and the addresses to reach it:
 *   - `peerAddr` (the native pubKey) → the conversational channel over sa.peer
 *     (mdns/relay/nkn) — journey A;
 *   - `url` (the A2A base URL) → the HTTP A2A path (P4 skill dispatch) for a
 *     URL-only agent with no peer address.
 */

/** A peer is a bot/agent when it's an A2A/hybrid agent or exposes skills. */
function isBot(peer) {
  if (!peer) return false;
  if (peer.type === 'a2a' || peer.type === 'hybrid') return true;
  return Array.isArray(peer.skills) && peer.skills.length > 0;
}

/** One roster row from a PeerGraph record. */
export function peerToContactRow(peer) {
  if (!peer) return null;
  const contactId = peer.pubKey ?? peer.url;
  if (!contactId) return null;
  return {
    contactId,
    name:       peer.name ?? peer.label ?? contactId,
    isBot:      isBot(peer),
    skillCount: Array.isArray(peer.skills) ? peer.skills.length : 0,
    reachable:  peer.reachable !== false,
    peerAddr:   peer.pubKey ?? null,   // native address → sa.peer conversational channel
    url:        peer.url ?? null,      // A2A base URL → HTTP task path
  };
}

/**
 * List the contact roster from a PeerGraph. Bots first (the actionable ones for
 * journey A), then by name; deterministic so the screen doesn't reshuffle on
 * every refresh.
 *
 * @param {{ all: () => Promise<object[]> } | null} peerGraph  the agent's `peers`
 * @returns {Promise<Array<object>>}
 */
export async function listContacts(peerGraph) {
  if (!peerGraph || typeof peerGraph.all !== 'function') return [];
  let peers = [];
  try { peers = await peerGraph.all(); } catch { return []; }
  const rows = peers.map(peerToContactRow).filter(Boolean);
  rows.sort((a, b) => {
    if (a.isBot !== b.isBot) return a.isBot ? -1 : 1;     // bots first
    return String(a.name).localeCompare(String(b.name));
  });
  return rows;
}

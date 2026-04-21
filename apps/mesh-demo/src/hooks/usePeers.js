/**
 * usePeers — live list of peers from the agent's PeerGraph.
 *
 * Re-renders whenever a peer is added, removed, or changes reachability.
 * Returns peers sorted: reachable direct first, then reachable indirect, then unreachable.
 */
import { useState, useEffect } from 'react';
import { useAgent } from '../context/AgentContext';

/**
 * @typedef {Object} PeerRow
 * @property {string}       pubKey
 * @property {string|null}  label
 * @property {boolean}      reachable
 * @property {number}       hops       — 0 = direct, 1 = via relay hop
 * @property {string|null}  via        — pubKey of relay peer (if hops > 0)
 * @property {string[]}     transports — known transport names for this peer
 * @property {number|null}  lastSeen
 */

/**
 * @returns {PeerRow[]}
 */
export function usePeers() {
  const { agent, status } = useAgent();
  const [peers, setPeers] = useState([]);

  useEffect(() => {
    if (status !== 'ready' || !agent?.peers) return;

    const graph = agent.peers;

    function refresh() {
      graph.all().then(records => {
        const rows = records.map(r => ({
          pubKey:     r.pubKey ?? r.url ?? '?',
          label:      r.label ?? null,
          reachable:  r.reachable ?? false,
          hops:       r.hops ?? 0,
          via:        r.via ?? null,
          transports: Object.keys(r.transports ?? {}),
          lastSeen:   r.lastSeen ?? null,
        }));

        // Sort: reachable direct → reachable indirect → unreachable
        rows.sort((a, b) => {
          if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
          if (a.hops !== b.hops) return a.hops - b.hops;
          return (a.label ?? a.pubKey).localeCompare(b.label ?? b.pubKey);
        });

        setPeers(rows);
      }).catch(() => {});
    }

    refresh();
    graph.on('added',       refresh);
    graph.on('removed',     refresh);
    graph.on('reachable',   refresh);
    graph.on('unreachable', refresh);

    return () => {
      graph.off('added',       refresh);
      graph.off('removed',     refresh);
      graph.off('reachable',   refresh);
      graph.off('unreachable', refresh);
    };
  }, [agent, status]);

  return peers;
}

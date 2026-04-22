/**
 * useRendezvousState — live set of peer pubKeys with an active direct
 * WebRTC DataChannel.
 *
 * Subscribes to `rendezvous-upgraded` / `rendezvous-downgraded` on the
 * agent (Group AA) and returns a Set of peer addresses that currently
 * have an open channel.  UI uses this to render a 🔗 icon on rows where
 * the data path has been lifted off the relay.
 *
 * Returns an empty Set when the agent is not ready or rendezvous is not
 * enabled (e.g. react-native-webrtc isn't installed).
 */
import { useState, useEffect } from 'react';
import { useAgent }            from '../context/AgentContext';

/**
 * @returns {Set<string>}  peer addresses with an open DataChannel.
 */
export function useRendezvousState() {
  const { agent, status } = useAgent();
  const [active, setActive] = useState(() => new Set());

  useEffect(() => {
    if (status !== 'ready' || !agent) return;

    function onUp({ peer }) {
      if (!peer) return;
      setActive(prev => {
        if (prev.has(peer)) return prev;
        const next = new Set(prev);
        next.add(peer);
        return next;
      });
    }

    function onDown({ peer }) {
      if (!peer) return;
      setActive(prev => {
        if (!prev.has(peer)) return prev;
        const next = new Set(prev);
        next.delete(peer);
        return next;
      });
    }

    agent.on('rendezvous-upgraded',   onUp);
    agent.on('rendezvous-downgraded', onDown);

    return () => {
      agent.off('rendezvous-upgraded',   onUp);
      agent.off('rendezvous-downgraded', onDown);
    };
  }, [agent, status]);

  return active;
}

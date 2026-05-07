/**
 * AgentContext — React context that makes the agent available to all screens.
 *
 * Usage:
 *   // read the agent anywhere
 *   const { agent, status, error } = useAgent();
 *
 * Status values:
 *   'starting'  — createAgent() in progress
 *   'ready'     — agent.start() resolved; transports connected
 *   'error'     — startup failed; see error field
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { createAgent } from '../agent';

// ── Context ───────────────────────────────────────────────────────────────────

const AgentContext = createContext(null);

// ── Provider ──────────────────────────────────────────────────────────────────

/**
 * Wrap your app root with this provider.
 * createAgent() is called once; the agent is stored and never recreated.
 */
export function AgentProvider({ children }) {
  const [agent,  setAgent]  = useState(null);
  const [status, setStatus] = useState('starting');
  const [error,  setError]  = useState(null);

  useEffect(() => {
    let cancelled = false;

    createAgent()
      .then(a => {
        if (cancelled) { a.stop(); return; }
        setAgent(a);
        setStatus('ready');
      })
      .catch(err => {
        if (!cancelled) {
          setError(err);
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      // agent?.stop() is called inside the then() guard above if cancelled early,
      // but if the agent is already set we stop it on unmount.
      setAgent(prev => { prev?.stop(); return null; });
    };
  }, []);

  return (
    <AgentContext.Provider value={{ agent, status, error }}>
      {children}
    </AgentContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * @returns {{ agent: import('@canopy/core').Agent|null, status: string, error: Error|null }}
 */
export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used inside <AgentProvider>');
  return ctx;
}

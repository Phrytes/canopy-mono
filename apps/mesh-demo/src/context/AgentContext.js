/**
 * AgentContext — React context that makes the agent available to all screens.
 *
 * Lifecycle:
 *   1. Loads saved relayUrl from AsyncStorage ('loading')
 *   2. If none → status 'needs-setup' (App shows SetupScreen)
 *   3. Once relayUrl is available → createAgent() ('starting')
 *   4. Agent ready → status 'ready'
 *   5. On error   → status 'error'
 *
 * Usage:
 *   const { agent, status, error, relayUrl, configure } = useAgent();
 *   configure(url)  // call from SetupScreen to set relay URL and start agent
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createAgent }    from '../agent.js';
import { loadSettings, saveSettings } from '../store/settings.js';

const AgentContext = createContext(null);

export function AgentProvider({ children }) {
  const [agent,    setAgent]    = useState(null);
  const [status,   setStatus]   = useState('loading');  // loading|needs-setup|starting|ready|error
  const [error,    setError]    = useState(null);
  const [relayUrl, setRelayUrl] = useState(null);

  // Load saved relay URL on mount
  useEffect(() => {
    loadSettings()
      .then(s => {
        if (s.relayUrl) {
          setRelayUrl(s.relayUrl);
          setStatus('starting');
        } else {
          setStatus('needs-setup');
        }
      })
      .catch(err => {
        setError(err);
        setStatus('needs-setup');
      });
  }, []);

  // Start agent whenever relayUrl is set (and status is 'starting')
  useEffect(() => {
    if (status !== 'starting' || !relayUrl) return;
    let cancelled = false;

    createAgent({ relayUrl })
      .then(a => {
        if (cancelled) { a.stop(); return; }
        a.on('error', err => { setError(err); setStatus('error'); });
        setAgent(a);
        setStatus('ready');
      })
      .catch(err => {
        if (!cancelled) { setError(err); setStatus('error'); }
      });

    return () => {
      cancelled = true;
      setAgent(prev => { prev?.stop(); return null; });
    };
  }, [status, relayUrl]);

  /** Called by SetupScreen once the user enters a relay URL. */
  const configure = useCallback(async (url) => {
    await saveSettings({ relayUrl: url });
    setRelayUrl(url);
    setStatus('starting');
  }, []);

  /** Reset settings and return to setup screen. */
  const reset = useCallback(async () => {
    await saveSettings({ relayUrl: null });
    agent?.stop();
    setAgent(null);
    setRelayUrl(null);
    setStatus('needs-setup');
  }, [agent]);

  return (
    <AgentContext.Provider value={{ agent, status, error, relayUrl, configure, reset }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used inside <AgentProvider>');
  return ctx;
}

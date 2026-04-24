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
import AsyncStorage        from '@react-native-async-storage/async-storage';
import { createAgent }    from '../agent.js';
import { loadSettings, saveSettings } from '../store/settings.js';

const PEER_GRAPH_PREFIX = 'mesh-demo:peers:';

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

  // Start (or restart) the agent whenever `relayUrl` changes.
  //
  // IMPORTANT: the dependency array must be `[relayUrl]` only — NOT
  // `[status, relayUrl]`.  With `status` in the deps, the effect re-runs
  // when the agent itself transitions 'starting' → 'ready', which fires
  // the previous effect's cleanup and silently nulls the just-created
  // agent.  Symptom: PeersScreen renders with status='ready' but
  // `agent` is null, so `MY ADDRESS` shows `—`.
  useEffect(() => {
    if (!relayUrl) return;
    let cancelled = false;

    setStatus('starting');

    createAgent({ relayUrl })
      .then(a => {
        if (cancelled) { a.stop(); return; }
        // Once the agent has reached 'ready', runtime errors from
        // transports (e.g. relay WebSocket drops when Wi-Fi toggles)
        // are transient and should NOT demote the UI to the error
        // screen.  The relay auto-reconnects with backoff; BLE resumes
        // when the radio is back; mDNS picks up when the interface
        // returns.  Just log them and record the most-recent error for
        // diagnostics — the user keeps a usable Peers screen.
        a.on('error', err => {
          console.warn('[agent error]', err?.message ?? err);
          setError(err);
        });
        setAgent(a);
        setStatus('ready');
      })
      .catch(err => {
        // Boot-time errors (identity generation, primary-transport
        // startup, etc.) ARE fatal — the user needs to re-enter the
        // relay URL or reinstall.
        if (!cancelled) { setError(err); setStatus('error'); }
      });

    return () => {
      cancelled = true;
      setAgent(prev => { prev?.stop(); return null; });
    };
  }, [relayUrl]);

  /** Called by SetupScreen once the user enters a relay URL. */
  const configure = useCallback(async (url) => {
    await saveSettings({ relayUrl: url });
    setRelayUrl(url);
    setStatus('starting');
  }, []);

  /** Reset settings and return to setup screen. */
  const reset = useCallback(async () => {
    await saveSettings({ relayUrl: null });
    // Also wipe the persisted PeerGraph — stale peers accumulate between
    // sessions (the graph is merge-not-replace), and when Wi-Fi/relay is
    // unreachable they cause callWithHop to keep trying dead bridges.
    try {
      const keys = await AsyncStorage.getAllKeys();
      const peerKeys = keys.filter(k => k.startsWith(PEER_GRAPH_PREFIX));
      if (peerKeys.length) await AsyncStorage.multiRemove(peerKeys);
    } catch { /* best effort */ }
    agent?.stop();
    setAgent(null);
    setRelayUrl(null);
    setStatus('needs-setup');
  }, [agent]);

  /** Clear cached peers WITHOUT logging out — useful when BLE routing gets
   *  confused because an old session left an indirect record for a peer
   *  that's now directly reachable over BLE or mDNS. */
  const forgetPeers = useCallback(async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const peerKeys = keys.filter(k => k.startsWith(PEER_GRAPH_PREFIX));
      if (peerKeys.length) await AsyncStorage.multiRemove(peerKeys);
    } catch { /* best effort */ }
    // Restart the agent so in-memory transport caches (BLE _hasPeer maps,
    // SecurityLayer keys) also clear.  Changing relayUrl's identity by
    // flipping to null and back re-runs the main effect.
    //
    // 50 ms wasn't enough: Android's BLE stack needs real time to process
    // scan-stop + advertise-stop before a new BleTransport tries to
    // startScan() and startAdvertising() on a fresh manager.  1.5 s is
    // empirically enough to avoid "BLE peers vanish after forget peers"
    // symptoms on both Samsung and FP4.
    if (relayUrl) {
      const saved = relayUrl;
      setRelayUrl(null);
      setTimeout(() => setRelayUrl(saved), 1500);
    }
  }, [relayUrl]);

  return (
    <AgentContext.Provider value={{ agent, status, error, relayUrl, configure, reset, forgetPeers }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent must be used inside <AgentProvider>');
  return ctx;
}

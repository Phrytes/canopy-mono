/**
 * App.js — canopy-chat-mobile root.
 *
 * M1 (2026-05-29) — the agent bundle is booted ONCE here and shared
 * with BOTH the chat screen and the circle launcher, so the circle
 * screens can load/create over the same agent (one NKN identity, one
 * stoop cache).  ChatScreen attaches its peer-wiring after mount via
 * `bundle.attachPeerWiring` — the inbound router closes over ChatScreen's
 * thread state, which App can't see, so it can't be passed at boot time.
 *
 * Per the polyfill discipline in index.js, all global setup must happen
 * there — App.js stays safe to import from a test context where
 * polyfills aren't loaded (the portable core in src/core/ has no RN
 * imports).
 */
import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useFonts, SourceSerif4_400Regular, SourceSerif4_600SemiBold,
} from '@expo-google-fonts/source-serif-4';

import { theme } from './src/screens/v2/theme.js';

import ChatScreen from './src/screens/ChatScreen.js';
import CircleLauncherScreen from './src/screens/v2/CircleLauncherScreen.js';
import { initLocalisation } from './src/core/localisation.js';
import { bootAgentBundle } from './src/core/agentBundle.js';
import { dlog } from './src/core/devLog.js';
import { EventLog } from '../canopy-chat/src/eventLog.js';

export default function App() {
  const [localeReady, setLocaleReady] = useState(false);
  // Load Source Serif 4 in the background — NOT gated on render (gating once
  // hung boot at a black screen). Headings switch from system serif to
  // Source Serif 4 once it resolves.
  useFonts({ SourceSerif4_400Regular, SourceSerif4_600SemiBold });
  // M2 (2026-05-29) — the circle launcher is the DEFAULT landing screen
  // (web already lands on the circle app).  The classic chat shell stays
  // mounted underneath (so its peer-wiring keeps routing inbound DMs /
  // mesh even while the launcher is up) and is revealed via "← chat".
  const [screen, setScreen] = useState('circles');
  const [bundle, setBundle] = useState(null);
  const [bootError, setBootError] = useState(null);

  // Shared EventLog: boot-time agent events + ChatScreen's inbound peer
  // events land in one log so /logs shows everything.
  const eventLogRef = useRef(null);
  if (!eventLogRef.current) {
    eventLogRef.current = new EventLog({ initial: [], muted: [] });
  }

  useEffect(() => {
    initLocalisation({ lng: 'en' }).then(() => setLocaleReady(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        dlog.boot('booting agent bundle (App)');
        let eventSeq = 0;
        const b = await bootAgentBundle({
          // Persist the agent identity (chat + host vaults + stoop
          // cache) to AsyncStorage so the NKN address — derived from the
          // identity keypair — stays stable across reboots (otherwise a
          // peer's cached nknAddr from a /share-my-contact QR breaks).
          asyncStorage: AsyncStorage,
          publishEvent: (e) => {
            if (!e || typeof e !== 'object') return;
            const evt = {
              ...e,
              id: e.id ?? `mob-${Date.now()}-${(eventSeq += 1).toString(36)}`,
              ts: e.ts ?? Date.now(),
            };
            try { eventLogRef.current?.append?.(evt); } catch { /* defensive */ }
          },
        });
        if (cancelled) { b.dispose?.(); return; }
        dlog.boot('bundle ready (App)', {
          transport:  b.transport,
          appOrigins: [...b.catalog.appOrigins],
          opCount:    b.catalog.opsById?.size ?? 0,
        });
        setBundle(b);
      } catch (err) {
        dlog.warn('boot failed (App)', err?.message ?? err);
        if (!cancelled) setBootError(err?.message ?? String(err));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!localeReady) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <View style={styles.root}>
        {/* ChatScreen is ALWAYS mounted so its peer-wiring stays attached
            (inbound DMs / mesh land even while the circle launcher is the
            visible screen). */}
        <ChatScreen bundle={bundle} bootError={bootError} eventLog={eventLogRef.current} />
        {screen === 'circles' ? (
          <View style={styles.overlay}>
            <CircleLauncherScreen bundle={bundle} eventLog={eventLogRef.current} onBack={() => setScreen('chat')} />
          </View>
        ) : (
          <Pressable
            style={styles.pill}
            accessibilityRole="button"
            testID="open-circles"
            onPress={() => setScreen('circles')}
          >
            <Text style={styles.pillText}>Circles</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Opaque full-bleed overlay so the always-mounted chat shell behind it
  // doesn't bleed through while the circle launcher is the active screen.
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: theme.color.paper,
  },
  pill: {
    position: 'absolute', top: 8, right: 12,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: theme.color.accent,
  },
  pillText: { color: theme.color.white, fontSize: 12, fontWeight: '600' },
});

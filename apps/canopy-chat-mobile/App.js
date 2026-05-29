/**
 * App.js — canopy-chat-mobile root.  V0 skeleton: just renders the
 * ChatScreen.  When more screens land (Threads, Settings, per-app
 * pages from renderMobile NavModels), this gains a bottom-tab nav
 * matching the [[platform-parity]] convention from stoop-mobile.
 *
 * Per the polyfill discipline in index.js, all global setup must
 * happen there — App.js should be safe to import from a test
 * context where polyfills are not loaded (which is why the
 * portable core layer in src/core/ has zero RN imports).
 */
import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import ChatScreen from './src/screens/ChatScreen.js';
import CircleLauncherScreen from './src/screens/v2/CircleLauncherScreen.js';
import { initLocalisation } from './src/core/localisation.js';

export default function App() {
  const [localeReady, setLocaleReady] = useState(false);
  // v2: web already defaults to the circle app. Mobile stays chat-default
  // until the agent bundle is lifted to App level (ChatScreen boots it
  // internally today, so the launcher has no bundle to load/create with).
  // Reachable now via the "Circles" pill; flip to 'circles' after the lift.
  const [screen, setScreen] = useState('chat');

  useEffect(() => {
    initLocalisation({ lng: 'en' }).then(() => setLocaleReady(true));
  }, []);

  if (!localeReady) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <View style={styles.root}>
        {screen === 'circles'
          ? <CircleLauncherScreen onBack={() => setScreen('chat')} />
          : <ChatScreen />}
        {screen === 'chat' ? (
          <Pressable
            style={styles.pill}
            accessibilityRole="button"
            onPress={() => setScreen('circles')}
          >
            <Text style={styles.pillText}>Circles</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pill: {
    position: 'absolute', top: 8, right: 12,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#c9a13a',
  },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});

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
import { StatusBar } from 'expo-status-bar';

import ChatScreen from './src/screens/ChatScreen.js';
import { initLocalisation } from './src/core/localisation.js';

export default function App() {
  const [localeReady, setLocaleReady] = useState(false);

  useEffect(() => {
    initLocalisation({ lng: 'en' }).then(() => setLocaleReady(true));
  }, []);

  if (!localeReady) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <ChatScreen />
    </SafeAreaProvider>
  );
}

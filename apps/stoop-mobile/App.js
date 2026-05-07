/**
 * App.js — stoop-mobile root component.
 *
 * Phase 40.10 (V3 mobile, 2026-05-08): full route table wired into a
 * react-navigation native-stack. Most screens still render the
 * `PlaceholderScreen` until their dedicated screen file is shipped
 * — see `src/screens/<Name>Screen.js`. The route table itself lives
 * in `src/navigation.js` (single source of truth shared with the
 * future deep-link handler in Phase 40.11).
 */

import React from 'react';
import { ScrollView, StatusBar, StyleSheet, Text } from 'react-native';

if (typeof globalThis !== 'undefined') {
  const prev = globalThis.onunhandledrejection;
  globalThis.onunhandledrejection = (event) => {
    const err = event?.reason ?? event;
    console.error('[unhandledRejection]', err?.message ?? err);
    if (err?.stack) console.error('[unhandledRejection stack]', err.stack);
    prev?.(event);
  };
}

if (typeof globalThis.ErrorUtils?.setGlobalHandler === 'function') {
  const prev = globalThis.ErrorUtils.getGlobalHandler?.();
  globalThis.ErrorUtils.setGlobalHandler((err, isFatal) => {
    console.error('[globalError]', isFatal ? 'FATAL' : 'non-fatal', err?.message ?? err);
    if (err?.stack) console.error('[globalError stack]', err.stack);
    prev?.(err, isFatal);
  });
}

import { NavigationContainer }        from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider }           from 'react-native-safe-area-context';

import { ROUTES, ROUTE_ORDER }        from './src/navigation.js';
import { PlaceholderScreen }          from './src/screens/PlaceholderScreen.js';
import { WelcomeScreen }              from './src/screens/WelcomeScreen.js';
import { OnboardScanScreen }          from './src/screens/OnboardScanScreen.js';
import { OnboardRestoreScreen }       from './src/screens/OnboardRestoreScreen.js';
import { ProfileMineScreen }          from './src/screens/ProfileMineScreen.js';
import { ProfileOtherScreen }         from './src/screens/ProfileOtherScreen.js';
import { FeedScreen }                 from './src/screens/FeedScreen.js';
import { PostComposeScreen }          from './src/screens/PostComposeScreen.js';
import { ItemDetailScreen }           from './src/screens/ItemDetailScreen.js';
import { initI18n }                   from './src/lib/i18n.js';

// Per-route screen components. As real screens land they replace
// `PlaceholderScreen` in this map. Keeping the map here (rather than
// inside `<Stack>`) means tests can introspect the route → component
// wiring without rendering.
const _initialMap = Object.fromEntries(ROUTE_ORDER.map((r) => [r, PlaceholderScreen]));
export const SCREEN_COMPONENTS = Object.freeze({
  ..._initialMap,
  [ROUTES.Welcome]:        WelcomeScreen,
  [ROUTES.OnboardScan]:    OnboardScanScreen,
  [ROUTES.OnboardRestore]: OnboardRestoreScreen,
  [ROUTES.ProfileMine]:    ProfileMineScreen,
  [ROUTES.ProfileOther]:   ProfileOtherScreen,
  [ROUTES.Feed]:           FeedScreen,
  [ROUTES.PostCompose]:    PostComposeScreen,
  [ROUTES.ItemDetail]:     ItemDetailScreen,
});

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error?.message ?? error);
    if (info?.componentStack) console.error(info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView style={styles.errorRoot}>
        <Text style={styles.errorTitle}>Something went wrong.</Text>
        <Text style={styles.errorBody}>
          {String(this.state.error?.message ?? this.state.error)}
        </Text>
      </ScrollView>
    );
  }
}

const Stack = createNativeStackNavigator();

// Kick off i18n once at module-load. Default to English; settings
// will swap to Dutch (or whatever) after first hydration.
initI18n({ lng: 'en' }).catch((err) => {
  console.warn('[i18n] init failed (falling back to keys):', err?.message ?? err);
});

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar barStyle="default" />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName={ROUTES.Welcome}
            screenOptions={{ headerShown: false }}
          >
            {ROUTE_ORDER.map((name) => (
              <Stack.Screen
                key={name}
                name={name}
                component={SCREEN_COMPONENTS[name]}
              />
            ))}
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  errorRoot:  { flex: 1, padding: 24, backgroundColor: '#fee' },
  errorTitle: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  errorBody:  { fontFamily: 'monospace', fontSize: 14 },
});

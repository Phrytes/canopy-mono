/**
 * App.js — stoop-mobile root component.
 *
 * Phase 40.1 (V3 mobile, 2026-05-08): scaffold only.  A welcome
 * placeholder; real navigation + screens land in Phase 40.10.
 *
 * Stack navigation is wired but only Welcome is implemented; the
 * other screens are stubbed as `<Text>placeholder</Text>` so the
 * stack compiles and dev-client builds without errors.
 */

import React from 'react';
import { ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';

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

function WelcomeScreen() {
  return (
    <View style={styles.welcomeRoot}>
      <Text style={styles.welcomeTitle}>Stoop</Text>
      <Text style={styles.welcomeBody}>
        Buurt-skill-app voor mobiel — V3 scaffold.{'\n\n'}
        Phase 40.1 ✓: workspace exists.{'\n'}
        Phase 40.10 will land the real screens.
      </Text>
    </View>
  );
}

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar barStyle="default" />
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Welcome"
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  welcomeRoot: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 24, backgroundColor: '#fdf8ec',
  },
  welcomeTitle: { fontSize: 36, fontWeight: '600', marginBottom: 12 },
  welcomeBody:  { fontSize: 16, textAlign: 'center', color: '#3a3325' },
  errorRoot:  { flex: 1, padding: 24, backgroundColor: '#fee' },
  errorTitle: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  errorBody:  { fontFamily: 'monospace', fontSize: 14 },
});

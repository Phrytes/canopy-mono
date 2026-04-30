/**
 * App.js — folio-mobile root component.
 *
 * Stack navigation:
 *   - SignIn  (modal-ish: shown when status === 'signed-out')
 *   - Status  (the main landing screen post-sign-in)
 *   - Notes / NoteEdit / Conflicts / Share / Settings
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

// Hook into RN's global error utils so synchronous uncaught errors AND
// unhandled-promise reasons print their stacks to logcat.  Hermes's
// default printer drops stack frames; this surfaces them.
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

import { ServiceProvider, useService } from './src/ServiceContext.js';
import { SignInScreen }     from './src/screens/SignInScreen.js';
import { StatusScreen }     from './src/screens/StatusScreen.js';
import { NotesListScreen }  from './src/screens/NotesListScreen.js';
import { NoteEditScreen }   from './src/screens/NoteEditScreen.js';
import { ConflictsScreen }  from './src/screens/ConflictsScreen.js';
import { ShareScreen }      from './src/screens/ShareScreen.js';
import { SettingsScreen }   from './src/screens/SettingsScreen.js';

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <View style={eb.root}>
          <Text style={eb.title}>Startup error</Text>
          <ScrollView style={eb.scroll}>
            <Text style={eb.msg} selectable>
              {this.state.error?.message ?? String(this.state.error)}{'\n\n'}
              {this.state.error?.stack ?? ''}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

const eb = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#0f1117', padding: 24, paddingTop: 60 },
  title:  { color: '#e05c5c', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  scroll: { flex: 1, backgroundColor: '#1a1d27', borderRadius: 8, padding: 12 },
  msg:    { color: '#d4d8f0', fontSize: 11, fontFamily: 'monospace', lineHeight: 18 },
});

const Stack = createNativeStackNavigator();

const screenOptions = {
  headerStyle:            { backgroundColor: '#141720' },
  headerTintColor:        '#d4d8f0',
  headerTitleStyle:       { fontWeight: '600' },
  contentStyle:           { backgroundColor: '#0f1117' },
  headerShadowVisible:    false,
  headerBackTitleVisible: false,
};

function AppInner() {
  const { status } = useService();

  if (status === 'loading') {
    return (
      <View style={loadingStyles.root}>
        <Text style={loadingStyles.label}>Loading Folio…</Text>
      </View>
    );
  }
  if (status === 'signed-out') {
    return <SignInScreen />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen name="Status"    component={StatusScreen}    options={{ title: 'Folio' }} />
        <Stack.Screen name="Notes"     component={NotesListScreen} options={{ title: 'Notes' }} />
        <Stack.Screen name="NoteEdit"  component={NoteEditScreen}  options={{ title: 'Edit' }} />
        <Stack.Screen name="Conflicts" component={ConflictsScreen} options={{ title: 'Conflicts' }} />
        <Stack.Screen name="Share"     component={ShareScreen}     options={{ title: 'Share' }} />
        <Stack.Screen name="Settings"  component={SettingsScreen}  options={{ title: 'Settings' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const loadingStyles = StyleSheet.create({
  root:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f1117' },
  label: { color: '#9aa0c4', fontSize: 14 },
});

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0f1117" />
      <ErrorBoundary>
        <ServiceProvider>
          <AppInner />
        </ServiceProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

/**
 * App.js — tasks-mobile root component.
 *
 * Phase 41.2 (2026-05-09): wraps the navigator in
 * `<ServiceProvider>` + `<I18nProvider>` + `<ThemeProvider>`. The
 * placeholder screen reads boot status from `useService()` and shows
 * a small splash while the agent identity is bootstrapped (~200 ms).
 *
 * Real screens land in Phase 41.3 onwards; the route table is only
 * one entry today.
 */

import React from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@canopy/react-native/theme';
import { ServiceProvider, useService } from './src/ServiceContext.js';
import { I18nProvider, useI18n } from './src/I18nProvider.js';

const Stack = createNativeStackNavigator();

// Tasks-mobile palette — neutral teal/blue (Tasks brand). Falls
// back to substrate DEFAULT_TOKENS for anything not specified.
const TASKS_TOKENS = {
  COLORS: {
    primary:      '#0d9488',
    primaryDark:  '#0f766e',
    primaryLight: '#99f6e4',
  },
};

function PlaceholderScreen() {
  const svc = useService();
  const { t } = useI18n();

  if (!svc || svc.status === 'booting') {
    return (
      <View style={styles.center}>
        <Text style={styles.subtitle}>{t('mobile.boot.loading', 'Booting…')}</Text>
      </View>
    );
  }

  if (svc.status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{t('mobile.boot.error', 'Couldn’t start')}</Text>
        <Text style={styles.hint}>{String(svc.error?.message ?? svc.error ?? '')}</Text>
      </View>
    );
  }

  // status === 'ready' — show either the no-crews empty state or a
  // brief acknowledgement that the agent is up + identity surfaced.
  if (svc.crews.size === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{t('mobile.no_crews.title', 'No crews yet')}</Text>
        <Text style={styles.hint}>{t('mobile.no_crews.body', 'Scan an invite QR to join a crew.')}</Text>
        <Text style={styles.subtitle}>
          {svc.identity?.pubKey?.slice(0, 12) ?? '(no pubkey)'}…
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Tasks Mobile</Text>
      <Text style={styles.subtitle}>
        {svc.crews.size} crew{svc.crews.size === 1 ? '' : 's'} · active: {svc.activeCrewId ?? '—'}
      </Text>
      <Text style={styles.hint}>Phase 41.2 — workspace screens land in 41.4.</Text>
    </View>
  );
}

export default function App({ boot } = {}) {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <ThemeProvider value={TASKS_TOKENS}>
        <I18nProvider>
          <ServiceProvider boot={boot}>
            <NavigationContainer>
              <Stack.Navigator>
                <Stack.Screen
                  name="Placeholder"
                  component={PlaceholderScreen}
                  options={{ title: 'Tasks' }}
                />
              </Stack.Navigator>
            </NavigationContainer>
          </ServiceProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
    marginBottom: 24,
    fontFamily: 'monospace',
  },
  hint: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    maxWidth: 320,
  },
});

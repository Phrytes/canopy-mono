/**
 * App.js — tasks-mobile root component.
 *
 * Phase 41.1 (2026-05-09): minimal scaffold. One screen renders
 * "Tasks Mobile — bring-up TODO." inside a `<NavigationContainer>`
 * so the route table is already mounted by the time Phase 41.2 wires
 * `<ServiceProvider>` underneath it.
 */

import React from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const Stack = createNativeStackNavigator();

function PlaceholderScreen() {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Tasks Mobile</Text>
      <Text style={styles.subtitle}>bring-up TODO</Text>
      <Text style={styles.hint}>
        Phase 41.1 scaffold. The agent + screens land in 41.2 and onwards.
      </Text>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="Placeholder"
            component={PlaceholderScreen}
            options={{ title: 'Tasks' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
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

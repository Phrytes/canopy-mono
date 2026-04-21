/**
 * App — root component.
 *
 * Wraps everything in AgentProvider so every screen has access to the agent.
 * Currently just shows PeersScreen directly (no navigator yet — Group B adds that).
 */
import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { AgentProvider } from './src/context/AgentContext';
import { PeersScreen } from './src/screens/PeersScreen';

export default function App() {
  return (
    <AgentProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0f1117" />
      <SafeAreaView style={styles.root}>
        <PeersScreen />
      </SafeAreaView>
    </AgentProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f1117' },
});

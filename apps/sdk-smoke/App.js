/**
 * SDK Smoke harness — App entry point.
 *
 * One screen, one section per scenario.  No chat UI, no Folio — this app
 * exists for one purpose: press a button, watch a scenario from the
 * coding-plans/sdk-two-device-smoke.md plan run on real hardware.
 *
 * Agent construction is lazy: we build the SDK agent on first scenario
 * run so app start stays cheap, and each scenario shares the one agent
 * (so they don't fight for the Keychain).  An Init button lets the user
 * pre-warm the agent before pressing scenarios.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ScenarioRow } from './src/components/ScenarioRow.js';
import { SCENARIOS } from './src/scenarios/index.js';
import { getSmokeAgent } from './src/lib/agent.js';
import { RELAY_URL } from './src/lib/config.js';

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

function Header({ agentStatus, onInit }) {
  return (
    <View style={s.header}>
      <Text style={s.h1}>SDK Smoke</Text>
      <Text style={s.h2}>
        Two-device hardware smoke harness — one button per scenario.
        See coding-plans/sdk-two-device-smoke.md.
      </Text>
      <View style={s.headerRow}>
        <Text style={s.relay}>Relay: <Text style={s.mono}>{RELAY_URL}</Text></Text>
        <Pressable
          style={({ pressed }) => [s.initBtn, pressed && { opacity: 0.7 }]}
          onPress={onInit}
        >
          <Text style={s.initBtnText}>
            {agentStatus === 'ready' ? 'Agent ready' :
             agentStatus === 'pending' ? 'Initializing…' :
             agentStatus === 'error' ? 'Init failed (tap to retry)' :
             'Init agent'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function App() {
  const [agent, setAgent] = useState(null);
  const [agentStatus, setAgentStatus] = useState('idle');  // idle | pending | ready | error
  const [agentError, setAgentError] = useState(null);

  const init = useCallback(async () => {
    if (agentStatus === 'pending' || agentStatus === 'ready') return;
    setAgentStatus('pending');
    setAgentError(null);
    try {
      const a = await getSmokeAgent();
      setAgent(a);
      setAgentStatus('ready');
    } catch (err) {
      setAgentStatus('error');
      setAgentError(err);
    }
  }, [agentStatus]);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#0f1117" />
        <SafeAreaView style={s.root}>
          <ScrollView contentContainerStyle={s.scroll}>
            <Header agentStatus={agentStatus} onInit={init} />
            {agentError && (
              <View style={s.errorBox}>
                <Text style={s.errorText}>
                  Agent init failed: {agentError?.message ?? String(agentError)}
                </Text>
              </View>
            )}
            {SCENARIOS.map((sc) => (
              <ScenarioRow key={sc.id} scenario={sc} sdk={agent} />
            ))}
            <Text style={s.footer}>
              Stub-mode: every `run()` currently returns `pending`.  Logic is
              filled in as scenarios are run on real devices.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#0f1117' },
  scroll:      { padding: 16, paddingBottom: 40 },
  header:      { marginBottom: 16 },
  h1:          { color: '#d4d8f0', fontSize: 22, fontWeight: '700' },
  h2:          { color: '#8c93b8', fontSize: 13, marginTop: 4, lineHeight: 18 },
  headerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  relay:       { color: '#6b7094', fontSize: 12 },
  mono:        { fontFamily: 'monospace', color: '#d4d8f0' },
  initBtn:     { backgroundColor: '#3b4670', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  initBtnText: { color: '#d4d8f0', fontSize: 13, fontWeight: '600' },
  errorBox:    { backgroundColor: '#3a1f23', padding: 10, borderRadius: 6, marginBottom: 12 },
  errorText:   { color: '#f0a8a8', fontSize: 12, fontFamily: 'monospace' },
  footer:      { color: '#6b7094', fontSize: 11, fontStyle: 'italic', marginTop: 12, textAlign: 'center' },
});

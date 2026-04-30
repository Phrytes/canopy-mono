/**
 * SettingsScreen — WebID, pod root, run-diagnostics, sign out.
 *
 * Diagnostics is the desktop's 16-step engine (`apps/folio/src/diagnostics.js`)
 * adapted for mobile.  v0 surfaces only those steps the mobile app can
 * actually run (config / vault / scanLocal / scanPod / pod-write probe);
 * the others SKIP with a brief note.  Future work expands coverage.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useService } from '../ServiceContext.js';
import { runMobileDiagnostics } from '../lib/diagnostics.js';

export { runMobileDiagnostics };

const APP_VERSION = '0.0.1';

export function SettingsScreen() {
  const { engine, oidc, podRoot, signOut, setPodRoot } = useService();
  const navigation = useNavigation();

  const [diagBusy, setDiagBusy] = useState(false);
  const [diag, setDiag]         = useState(null);
  const [editPodRoot, setEditPodRoot] = useState(podRoot ?? '');
  const [savingPodRoot, setSavingPodRoot] = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    navigation?.setOptions?.({ title: 'Settings' });
  }, [navigation]);

  // Re-sync the input when podRoot updates.
  useEffect(() => { setEditPodRoot(podRoot ?? ''); }, [podRoot]);

  const onPodRootSave = useCallback(async () => {
    if (savingPodRoot) return;
    if (!editPodRoot || editPodRoot === podRoot) return;
    setSavingPodRoot(true);
    setError(null);
    try {
      await setPodRoot(editPodRoot.endsWith('/') ? editPodRoot : `${editPodRoot}/`);
    } catch (err) {
      setError(err);
    } finally {
      setSavingPodRoot(false);
    }
  }, [editPodRoot, podRoot, setPodRoot, savingPodRoot]);

  const onRunDiagnostics = useCallback(async () => {
    if (diagBusy) return;
    setDiagBusy(true);
    setDiag(null);
    setError(null);
    try {
      const r = await runMobileDiagnostics({ engine, oidc, podRoot });
      setDiag(r);
    } catch (err) {
      setError(err);
    } finally {
      setDiagBusy(false);
    }
  }, [diagBusy, engine, oidc, podRoot]);

  const onSignOut = useCallback(() => {
    Alert.alert(
      'Sign out?',
      'This will remove your tokens from this device.  Your notes stay on the pod and can be retrieved by signing in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: signOut },
      ],
    );
  }, [signOut]);

  return (
    <ScrollView style={s.root} contentContainerStyle={s.scroll}>
      <Section title="Account">
        <Row label="WebID"  value={oidc?.webid ?? '—'} />
        <Row label="Issuer" value={oidc?.issuer ?? '—'} />
      </Section>

      <Section title="Pod">
        <Text style={s.fieldLabel}>Pod root</Text>
        <TextInput
          value={editPodRoot}
          onChangeText={setEditPodRoot}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={s.input}
        />
        <Pressable
          onPress={onPodRootSave}
          disabled={savingPodRoot || editPodRoot === podRoot}
          style={({ pressed }) => [
            s.smallBtn,
            (savingPodRoot || editPodRoot === podRoot) && { opacity: 0.5 },
            pressed && { opacity: 0.8 },
          ]}
        >
          {savingPodRoot
            ? <ActivityIndicator color="#0f1117" size="small" />
            : <Text style={s.smallBtnLabel}>Save pod root</Text>}
        </Pressable>
      </Section>

      <Section title="Diagnostics">
        <Pressable
          onPress={onRunDiagnostics}
          disabled={diagBusy || !engine}
          style={({ pressed }) => [
            s.secondaryBtn,
            (diagBusy || !engine) && { opacity: 0.5 },
            pressed && { opacity: 0.8 },
          ]}
        >
          {diagBusy
            ? <ActivityIndicator color="#9bcfff" />
            : <Text style={s.secondaryBtnLabel}>Run diagnostics</Text>}
        </Pressable>
        {diag && (
          <View style={s.diagBox}>
            {diag.steps.map((step, i) => (
              <Text key={i} style={[s.diagLine, statusColor(step.status)]}>
                {step.status.toUpperCase().padEnd(4)} · {step.label}
                {step.detail ? ` — ${step.detail}` : ''}
              </Text>
            ))}
          </View>
        )}
      </Section>

      <Section title="App">
        <Row label="Version" value={APP_VERSION} />
      </Section>

      <Pressable
        onPress={onSignOut}
        style={({ pressed }) => [s.dangerBtn, pressed && { opacity: 0.8 }]}
      >
        <Text style={s.dangerBtnLabel}>Sign out</Text>
      </Pressable>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error?.message ?? String(error)}</Text>
        </View>
      )}
    </ScrollView>
  );
}

function Section({ title, children }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.card}>{children}</View>
    </View>
  );
}

function Row({ label, value }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} selectable numberOfLines={2}>{value}</Text>
    </View>
  );
}

function statusColor(status) {
  switch (status) {
    case 'pass': return { color: '#9be0a8' };
    case 'fail': return { color: '#f0a8a8' };
    case 'warn': return { color: '#f0d6a8' };
    case 'skip': return { color: '#6b7094' };
    default:     return { color: '#9aa0c4' };
  }
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#0f1117' },
  scroll:  { padding: 16, paddingBottom: 80 },
  section: { marginBottom: 20 },
  sectionTitle: { color: '#6b7094', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  card:    { backgroundColor: '#141720', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1f2330' },
  row:     { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1f2330' },
  rowLabel:{ color: '#6b7094', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  rowValue:{ color: '#d4d8f0', fontSize: 13, fontFamily: 'monospace', marginTop: 2 },
  fieldLabel: { color: '#9aa0c4', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input:   {
    backgroundColor: '#1a1d27', color: '#d4d8f0', fontSize: 13,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6,
    borderWidth: 1, borderColor: '#2a2f3f', fontFamily: 'monospace',
  },
  smallBtn:    { backgroundColor: '#9bcfff', paddingVertical: 8, borderRadius: 6, alignItems: 'center', marginTop: 8 },
  smallBtnLabel: { color: '#0f1117', fontSize: 12, fontWeight: '700' },
  secondaryBtn: { backgroundColor: '#1a1d27', paddingVertical: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#2a2f3f' },
  secondaryBtnLabel: { color: '#9aa0c4', fontSize: 13, fontWeight: '500' },
  diagBox: { marginTop: 12 },
  diagLine: { fontSize: 11, fontFamily: 'monospace', lineHeight: 18 },
  dangerBtn: { backgroundColor: '#3a1f23', paddingVertical: 14, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#5c2e34', marginTop: 12 },
  dangerBtnLabel: { color: '#f0a8a8', fontSize: 14, fontWeight: '600' },
  errorBox: { backgroundColor: '#3a1f23', padding: 12, borderRadius: 6, marginTop: 16 },
  errorText:{ color: '#f0a8a8', fontSize: 12, fontFamily: 'monospace' },
});

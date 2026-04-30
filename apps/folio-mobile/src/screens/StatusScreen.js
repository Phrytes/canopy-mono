/**
 * StatusScreen — landing screen after sign-in.
 *
 * Shows: WebID, pod root, last sync, pending counts, "Sync now"
 * button, "Force re-push" button, and a Settings shortcut in the
 * header.  Re-renders on every engine event.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useService } from '../ServiceContext.js';
import { useEngineEvents } from '../lib/useEngineEvents.js';
import { SyncStatusPill } from '../components/SyncStatusPill.js';

export function StatusScreen() {
  const { engine, oidc, podRoot, runSyncNow, forcePush, status } = useService();
  const navigation = useNavigation();
  const tick = useEngineEvents();

  const [busy, setBusy]     = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [error, setError]   = useState(null);

  // Re-render when the engine fires events.
  useEffect(() => { /* tick */ }, [tick]);

  // Header right — Settings shortcut.
  useEffect(() => {
    if (!navigation?.setOptions) return;
    navigation.setOptions({
      title: 'Folio',
      headerRight: () => (
        <Pressable
          onPress={() => navigation.navigate('Settings')}
          style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={s.headerBtnLabel}>Settings</Text>
        </Pressable>
      ),
    });
  }, [navigation]);

  const onSyncNow = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await runSyncNow();
      setLastResult(r);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, runSyncNow]);

  const onForcePush = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await forcePush();
      setLastResult({ uploads: r.uploads, errors: r.errors });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, forcePush]);

  const stats = engine?.stats ?? { lastSyncAt: null, uploads: 0, downloads: 0, conflicts: 0 };

  return (
    <ScrollView style={s.root} contentContainerStyle={s.scroll}>
      <View style={s.section}>
        <SyncStatusPill
          status={busy ? 'running' : (error ? 'error' : 'idle')}
          lastSyncAt={stats.lastSyncAt}
          pending={0}
        />
      </View>

      <View style={s.card}>
        <Text style={s.cardLabel}>WebID</Text>
        <Text style={s.cardValue} selectable numberOfLines={2}>
          {oidc?.webid ?? '—'}
        </Text>

        <View style={s.divider} />

        <Text style={s.cardLabel}>Pod root</Text>
        <Text style={s.cardValue} selectable numberOfLines={2}>
          {podRoot ?? '—'}
        </Text>

        <View style={s.divider} />

        <Text style={s.cardLabel}>Last sync</Text>
        <Text style={s.cardValue}>
          {stats.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString() : 'never'}
        </Text>

        <View style={s.statsRow}>
          <Stat label="↑ uploaded"   value={stats.uploads} />
          <Stat label="↓ downloaded" value={stats.downloads} />
          <Stat label="⚠ conflicts"  value={stats.conflicts} />
        </View>
      </View>

      <Pressable
        onPress={onSyncNow}
        disabled={busy || status !== 'ready'}
        style={({ pressed }) => [
          s.primaryBtn,
          (busy || status !== 'ready') && { opacity: 0.5 },
          pressed && { opacity: 0.8 },
        ]}
      >
        {busy
          ? <ActivityIndicator color="#0f1117" />
          : <Text style={s.primaryBtnLabel}>Sync now</Text>}
      </Pressable>

      <Pressable
        onPress={onForcePush}
        disabled={busy || status !== 'ready'}
        style={({ pressed }) => [
          s.secondaryBtn,
          (busy || status !== 'ready') && { opacity: 0.5 },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text style={s.secondaryBtnLabel}>Force re-push (override remote)</Text>
      </Pressable>

      <Pressable
        onPress={() => navigation.navigate('Notes')}
        style={({ pressed }) => [s.linkBtn, pressed && { opacity: 0.6 }]}
      >
        <Text style={s.linkLabel}>View notes →</Text>
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('Conflicts')}
        style={({ pressed }) => [s.linkBtn, pressed && { opacity: 0.6 }]}
      >
        <Text style={s.linkLabel}>Conflicts ({stats.conflicts}) →</Text>
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('Share')}
        style={({ pressed }) => [s.linkBtn, pressed && { opacity: 0.6 }]}
      >
        <Text style={s.linkLabel}>Share via capability token →</Text>
      </Pressable>

      {lastResult && (
        <View style={s.resultBox}>
          <Text style={s.resultText}>
            {JSON.stringify(lastResult, null, 2)}
          </Text>
        </View>
      )}

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error?.message ?? String(error)}</Text>
        </View>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value ?? 0}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#0f1117' },
  scroll:      { padding: 16 },
  section:     { marginBottom: 16 },
  card:        {
    backgroundColor: '#141720',
    borderRadius:    10,
    padding:         16,
    borderWidth:     1,
    borderColor:     '#1f2330',
    marginBottom:    16,
  },
  cardLabel:   { color: '#6b7094', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardValue:   { color: '#d4d8f0', fontSize: 14, fontFamily: 'monospace', marginTop: 4 },
  divider:     { height: 1, backgroundColor: '#1f2330', marginVertical: 12 },
  statsRow:    { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  stat:        { alignItems: 'center', flex: 1 },
  statValue:   { color: '#d4d8f0', fontSize: 20, fontWeight: '700' },
  statLabel:   { color: '#6b7094', fontSize: 11, marginTop: 2 },
  primaryBtn:  { backgroundColor: '#9bcfff', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  primaryBtnLabel: { color: '#0f1117', fontSize: 15, fontWeight: '700' },
  secondaryBtn:    { backgroundColor: '#1a1d27', paddingVertical: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#2a2f3f', marginBottom: 16 },
  secondaryBtnLabel:{ color: '#9aa0c4', fontSize: 13, fontWeight: '500' },
  linkBtn:     { paddingVertical: 10 },
  linkLabel:   { color: '#9bcfff', fontSize: 14 },
  headerBtn:   { paddingHorizontal: 12, paddingVertical: 6 },
  headerBtnLabel: { color: '#9bcfff', fontSize: 14, fontWeight: '500' },
  resultBox:   { backgroundColor: '#1a1d27', padding: 12, borderRadius: 6, marginTop: 12 },
  resultText:  { color: '#9aa0c4', fontSize: 11, fontFamily: 'monospace' },
  errorBox:    { backgroundColor: '#3a1f23', padding: 12, borderRadius: 6, marginTop: 12 },
  errorText:   { color: '#f0a8a8', fontSize: 12, fontFamily: 'monospace' },
});

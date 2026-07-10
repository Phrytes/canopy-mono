/**
 * VersionsScreen — per-note version history + restore (folio-mobile).
 *
 * Web⇄mobile parity fix (2026-05-18 audit): the desktop web app has a
 * History tab + per-file snapshot restore; folio-mobile had none — a
 * data-safety capability that was web-only. This wires the SAME engine
 * API the web routes use (`engine.versions(relPath)` /
 * `engine.restoreVersion(relPath, ts)`). Versioning rides the engine's
 * `@canopy/versioning` store (Slice 1a); it is reached via the engine
 * instance, never imported here (the store's default Node fs backend
 * imports `node:*`, and a non-Node host injects its own backend).
 *
 * Per folio-mobile's testing convention the React component is not
 * unit-rendered; the pure view-model mapper `toVersionRows` is
 * exported and unit-tested instead.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';

import { useService }                 from '../ServiceContext.js';
import { formatMtime, formatBytes }   from '../lib/format.js';
import { toVersionRows }              from '../lib/versionRows.js';

export function VersionsScreen() {
  const { engine } = useService();
  const route      = useRoute();
  const navigation = useNavigation();
  const relPath    = route?.params?.relPath ?? null;

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [busyTs, setBusyTs]   = useState(null);

  const load = useCallback(async () => {
    if (!engine?.versions || !relPath) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const list = await engine.versions(relPath);
      setRows(toVersionRows(list));
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [engine, relPath]);

  useEffect(() => { load(); }, [load]);

  const restore = useCallback((ts) => {
    Alert.alert(
      'Restore this version?',
      'The current content is saved as a new version first, so this is undoable.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            setBusyTs(ts);
            setError(null);
            try {
              await engine.restoreVersion(relPath, ts);
              await load();
            } catch (err) {
              setError(err?.message ?? String(err));
            } finally {
              setBusyTs(null);
            }
          },
        },
      ],
    );
  }, [engine, relPath, load]);

  if (!engine || !relPath) {
    return (
      <View style={s.center}>
        <Text style={s.muted}>No note selected.</Text>
      </View>
    );
  }
  if (loading) {
    return <View style={s.center}><ActivityIndicator color="#9bcfff" /></View>;
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title} numberOfLines={1}>{relPath}</Text>
      {error && (
        <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
      )}
      {rows.length === 0 ? (
        <Text style={s.muted}>No earlier versions yet.</Text>
      ) : rows.map((r) => (
        <View key={r.ts} style={s.row}>
          <View style={s.rowInfo}>
            <Text style={s.rowWhen}>{formatMtime(r.ts)}</Text>
            <Text style={s.rowMeta}>
              {formatBytes(r.size)}{r.sha8 ? `  ·  ${r.sha8}` : ''}
            </Text>
          </View>
          <Pressable
            style={[s.restoreBtn, busyTs === r.ts && s.restoreBtnBusy]}
            disabled={busyTs != null}
            onPress={() => restore(r.ts)}
            accessibilityRole="button"
            accessibilityLabel={`restore-version-${r.ts}`}
          >
            <Text style={s.restoreLabel}>
              {busyTs === r.ts ? '…' : 'Restore'}
            </Text>
          </Pressable>
        </View>
      ))}
      <Pressable style={s.backBtn} onPress={() => navigation.goBack()}>
        <Text style={s.backLabel}>Back to editor</Text>
      </Pressable>
    </ScrollView>
  );
}

export default VersionsScreen;

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#0f1117' },
  content: { padding: 16 },
  center:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f1117' },
  title:   { color: '#9bcfff', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  muted:   { color: '#5c6377', fontSize: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1c2030',
  },
  rowInfo:  { flex: 1 },
  rowWhen:  { color: '#d4d8f0', fontSize: 14 },
  rowMeta:  { color: '#5c6377', fontSize: 12, marginTop: 2 },
  restoreBtn: {
    paddingVertical: 6, paddingHorizontal: 14,
    backgroundColor: '#1c2740', borderRadius: 6,
  },
  restoreBtnBusy: { opacity: 0.5 },
  restoreLabel: { color: '#9bcfff', fontSize: 13, fontWeight: '600' },
  errorBox:  { backgroundColor: '#3a1c1c', borderRadius: 6, padding: 10, marginBottom: 12 },
  errorText: { color: '#ff9b9b', fontSize: 13 },
  backBtn:   { marginTop: 20, alignItems: 'center', paddingVertical: 12 },
  backLabel: { color: '#5c6377', fontSize: 13 },
});

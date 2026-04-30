/**
 * ConflictsScreen — list of conflicted files + per-conflict resolution.
 *
 * Files containing the conflict-markers (`<<<<<<<`, `=======`,
 * `>>>>>>>`) are listed.  Tapping a row expands a three-pane editor:
 *
 *   - "Yours"   — the local half of the conflict
 *   - "Theirs"  — the remote half
 *   - "Merged"  — initially the user's choice; editable
 *
 * Three buttons resolve:
 *   - Keep mine     → write the "yours" buffer
 *   - Keep theirs   → write the "theirs" buffer
 *   - Save merged   → write the merged buffer
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useService } from '../ServiceContext.js';
import { useEngineEvents } from '../lib/useEngineEvents.js';
import { listLocalFiles } from '../lib/notesList.js';
import {
  splitConflictText, hasConflictMarkers, CONFLICT_MARKER_OURS,
} from '../lib/conflictText.js';

export const CONFLICT_MARKER = CONFLICT_MARKER_OURS;
export { splitConflictText };

export function ConflictsScreen() {
  const { engine } = useService();
  const navigation = useNavigation();
  const tick = useEngineEvents();

  const [files, setFiles]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [selected, setSelected] = useState(null); // { relPath, absPath, mine, theirs, merged }

  useEffect(() => {
    navigation?.setOptions?.({ title: 'Conflicts' });
  }, [navigation]);

  const reload = useCallback(async () => {
    if (!engine) {
      setFiles([]); setLoading(false); return;
    }
    setLoading(true);
    setError(null);
    try {
      const all = await listLocalFiles({ fs: engine.fs, localRoot: engine.localRoot });
      const conflicted = [];
      for (const f of all) {
        try {
          const text = await engine.fs.readFileText(f.absPath, 'utf8');
          if (text.includes(CONFLICT_MARKER)) conflicted.push({ ...f, text });
        } catch { /* skip unreadable */ }
      }
      setFiles(conflicted);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [engine]);

  useEffect(() => { reload(); }, [reload, tick]);

  const open = useCallback((file) => {
    const split = splitConflictText(file.text);
    setSelected({
      relPath: file.relPath,
      absPath: file.absPath,
      mine:    split.mine,
      theirs:  split.theirs,
      merged:  split.mine,  // start with "yours" as the merge buffer
    });
  }, []);

  const resolveWith = useCallback(async (text) => {
    if (!selected || !engine) return;
    try {
      await engine.fs.writeFile(selected.absPath, text, { encoding: 'utf8' });
      setSelected(null);
      // Trigger sync so the resolved file lands on the pod.
      engine.runOnce?.().catch(() => {});
      reload();
    } catch (err) {
      setError(err);
    }
  }, [selected, engine, reload]);

  if (loading) return <View style={s.center}><ActivityIndicator color="#9bcfff" /></View>;

  if (selected) {
    return (
      <ScrollView style={s.root} contentContainerStyle={{ padding: 16 }}>
        <Text style={s.h1}>{selected.relPath}</Text>
        <Pane label="Yours"  text={selected.mine}   />
        <Pane label="Theirs" text={selected.theirs} />
        <Text style={s.paneLabel}>Merged (editable)</Text>
        <TextInput
          value={selected.merged}
          onChangeText={(t) => setSelected((p) => (p ? { ...p, merged: t } : p))}
          multiline
          style={s.mergeInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
        <View style={s.actions}>
          <Action label="Keep mine"   onPress={() => resolveWith(selected.mine)} />
          <Action label="Keep theirs" onPress={() => resolveWith(selected.theirs)} />
          <Action label="Save merged" primary onPress={() => resolveWith(selected.merged)} />
        </View>
        <Pressable onPress={() => setSelected(null)} style={s.cancel}>
          <Text style={s.cancelLabel}>Cancel</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <View style={s.root}>
      <FlatList
        data={files}
        keyExtractor={(item) => item.relPath}
        renderItem={({ item }) => (
          <Pressable onPress={() => open(item)} style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}>
            <Text style={s.rowName}>{item.relPath}</Text>
            <Text style={s.rowMeta}>{item.text.split('\n').length} lines · contains conflict markers</Text>
          </Pressable>
        )}
        ListEmptyComponent={<View style={s.center}><Text style={s.empty}>No conflicts.</Text></View>}
        ListFooterComponent={error ? (
          <View style={s.errorBox}><Text style={s.errorText}>{error?.message ?? String(error)}</Text></View>
        ) : null}
      />
    </View>
  );
}

function Pane({ label, text }) {
  return (
    <View style={s.paneBox}>
      <Text style={s.paneLabel}>{label}</Text>
      <Text style={s.paneText} selectable>{text || '(empty)'}</Text>
    </View>
  );
}

function Action({ label, onPress, primary }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        primary ? s.btnPrimary : s.btnSecondary,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={primary ? s.btnPrimaryLabel : s.btnSecondaryLabel}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#0f1117' },
  center: { padding: 32, alignItems: 'center' },
  empty:  { color: '#9aa0c4', fontSize: 14 },
  h1:     { color: '#d4d8f0', fontSize: 16, fontWeight: '700', marginBottom: 16 },
  row:    { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1f2330' },
  rowName: { color: '#d4d8f0', fontSize: 15, fontWeight: '500' },
  rowMeta: { color: '#6b7094', fontSize: 11, marginTop: 4 },
  paneBox: { marginBottom: 12, backgroundColor: '#141720', padding: 12, borderRadius: 8 },
  paneLabel: { color: '#9aa0c4', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  paneText:  { color: '#d4d8f0', fontSize: 12, fontFamily: 'monospace', lineHeight: 18 },
  mergeInput: {
    minHeight: 140, color: '#d4d8f0', backgroundColor: '#1a1d27',
    padding: 12, borderRadius: 8, fontFamily: 'monospace', fontSize: 12,
    textAlignVertical: 'top', marginBottom: 16,
  },
  actions:    { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  btn:        { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 6, marginVertical: 4 },
  btnPrimary: { backgroundColor: '#9bcfff' },
  btnSecondary: { backgroundColor: '#1a1d27', borderWidth: 1, borderColor: '#2a2f3f' },
  btnPrimaryLabel: { color: '#0f1117', fontSize: 13, fontWeight: '700' },
  btnSecondaryLabel: { color: '#9aa0c4', fontSize: 13 },
  cancel:     { padding: 14, alignItems: 'center', marginTop: 12 },
  cancelLabel:{ color: '#6b7094', fontSize: 13 },
  errorBox:   { backgroundColor: '#3a1f23', padding: 12, margin: 16, borderRadius: 6 },
  errorText:  { color: '#f0a8a8', fontSize: 12, fontFamily: 'monospace' },
});

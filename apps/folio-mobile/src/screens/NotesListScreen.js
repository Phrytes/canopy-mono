/**
 * NotesListScreen — FlatList of notes from the engine's localRoot.
 *
 * Tap a row → NoteEditScreen.  Tap "..." → per-file menu (history /
 * delete locally / delete from pod).
 *
 * Reload happens whenever the engine fires an event.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Pressable,
  StyleSheet, Text, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useService } from '../ServiceContext.js';
import { useEngineEvents } from '../lib/useEngineEvents.js';
import { listLocalFiles } from '../lib/notesList.js';
import { FileRow } from '../components/FileRow.js';

export function NotesListScreen() {
  const { engine, status } = useService();
  const navigation = useNavigation();
  const tick = useEngineEvents();

  const [files, setFiles]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  const reload = useCallback(async () => {
    if (!engine) {
      setFiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const out = await listLocalFiles({ fs: engine.fs, localRoot: engine.localRoot });
      setFiles(out);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [engine]);

  useEffect(() => { reload(); }, [reload, tick]);

  useEffect(() => {
    navigation?.setOptions?.({ title: 'Notes' });
  }, [navigation]);

  const onPress = useCallback((file) => {
    navigation.navigate('NoteEdit', { relPath: file.relPath, absPath: file.absPath });
  }, [navigation]);

  const onMore = useCallback((file) => {
    Alert.alert(
      file.name,
      'Choose an action.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text:    'Delete locally',
          style:   'destructive',
          onPress: async () => {
            try { await engine?.deleteLocal?.(file.relPath); reload(); }
            catch (err) { setError(err); }
          },
        },
        {
          text:    'Delete from pod',
          style:   'destructive',
          onPress: async () => {
            try { await engine?.deleteCompletely?.(file.relPath); reload(); }
            catch (err) { setError(err); }
          },
        },
      ],
    );
  }, [engine, reload]);

  if (status !== 'ready') {
    return (
      <View style={s.center}>
        <Text style={s.empty}>Sign in to see your notes.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#9bcfff" />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <FlatList
        data={files}
        keyExtractor={(item) => item.relPath}
        renderItem={({ item }) => (
          <FileRow file={item} onPress={() => onPress(item)} onMore={() => onMore(item)} />
        )}
        ListEmptyComponent={
          <View style={s.center}>
            <Text style={s.empty}>No notes yet.</Text>
            <Text style={s.subEmpty}>
              Drop a markdown file under the engine's local root, or push one from the
              desktop CLI to see it here after the next sync.
            </Text>
          </View>
        }
        ListFooterComponent={error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error?.message ?? String(error)}</Text>
          </View>
        ) : null}
      />
      <Pressable
        onPress={reload}
        style={({ pressed }) => [s.refreshBtn, pressed && { opacity: 0.7 }]}
      >
        <Text style={s.refreshLabel}>Refresh list</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#0f1117' },
  center: { padding: 32, alignItems: 'center' },
  empty:  { color: '#9aa0c4', fontSize: 14, textAlign: 'center' },
  subEmpty: { color: '#5c6377', fontSize: 12, marginTop: 8, textAlign: 'center', lineHeight: 18 },
  refreshBtn: { padding: 14, alignItems: 'center', backgroundColor: '#1a1d27', borderTopWidth: 1, borderTopColor: '#1f2330' },
  refreshLabel: { color: '#9bcfff', fontSize: 13 },
  errorBox: { backgroundColor: '#3a1f23', padding: 12, margin: 16, borderRadius: 6 },
  errorText: { color: '#f0a8a8', fontSize: 12, fontFamily: 'monospace' },
});

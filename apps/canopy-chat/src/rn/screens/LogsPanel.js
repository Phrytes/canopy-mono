/**
 * **Platform: RN**.  Logs viewer for canopy-chat-mobile
 * (Bundle F P3, #259, 2026-05-26).
 *
 * Mobile parallel of web's #121 side-panel.  Reads from an
 * `EventLog` instance (apps/canopy-chat/src/eventLog.js — portable;
 * the same class web uses) and renders a chronological list of
 * delivered events.  Wired via `openLogsPanel` callback in mobile
 * localBuiltins → ChatScreen sets state.logsPanelOpen → this modal
 * mounts.
 *
 * V1 caveats:
 *   - In-memory only on mobile (no IndexedDB).  AsyncStorage-backed
 *     persistence is a later follow-up.
 *   - Subscribes to the log so new events re-render the list while
 *     the modal is open.
 *
 * No hardcoded strings — labels via `t`.
 */
import React, { useState, useEffect } from 'react';
import {
  Modal, View, ScrollView, Text, TouchableOpacity, StyleSheet, Pressable,
} from 'react-native';

export default function LogsPanel({ visible, eventLog, onClose, t }) {
  const [events, setEvents] = useState(() => snapshot(eventLog));

  useEffect(() => {
    if (!visible || !eventLog) return;
    setEvents(snapshot(eventLog));
    const unsub = eventLog.subscribe?.(() => setEvents(snapshot(eventLog)));
    return () => { try { unsub?.(); } catch { /* defensive */ } };
  }, [visible, eventLog]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
          testID="logs-panel"
        >
          <View style={styles.header}>
            <Text style={styles.title}>{t('logs.panel_title')}</Text>
            <Text style={styles.subtitle}>
              {t('logs.panel_subtitle', { count: events.length })}
            </Text>
          </View>
          <ScrollView style={styles.list}>
            {events.length === 0 ? (
              <Text style={styles.empty}>{t('logs.panel_empty')}</Text>
            ) : (
              events.map((e) => (
                <View key={e.id} style={styles.row} testID={`logs-row-${e.id}`}>
                  <Text style={styles.rowTime}>{formatTime(e.ts)}</Text>
                  <Text style={styles.rowApp}>
                    <Text style={styles.rowAppName}>{e.app}</Text>
                    {`/${e.type}`}
                    {e.actor ? ` · ${e.actor}` : ''}
                  </Text>
                  {(e.payload?.message ?? e.payload?.text) ? (
                    <Text style={styles.rowText}>
                      {e.payload?.message ?? e.payload?.text}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
          </ScrollView>
          <View style={styles.footer}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              testID="logs-panel-close"
            >
              <Text style={styles.closeBtnText}>{t('common.done')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function snapshot(eventLog) {
  if (!eventLog) return [];
  try {
    return eventLog.query?.({ limit: 200, excludeMuted: true }) ?? [];
  } catch {
    return [];
  }
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 16)}`;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '92%', minHeight: '60%',
  },
  header: {
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  title:    { fontSize: 18, fontWeight: '700', color: '#222' },
  subtitle: { fontSize: 12, color: '#666', marginTop: 2 },
  list:     { flex: 1 },
  empty:    { fontSize: 13, color: '#888', textAlign: 'center', padding: 24 },
  row: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f3f3f3',
    gap: 2,
  },
  rowTime:    { fontSize: 11, color: '#888', fontFamily: 'monospace' },
  rowApp:     { fontSize: 12, color: '#666' },
  rowAppName: { fontWeight: '700', color: '#1e88e5' },
  rowText:    { fontSize: 13, color: '#222' },
  footer: {
    padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee',
    alignItems: 'flex-end',
  },
  closeBtn: {
    backgroundColor: '#1e88e5', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 18,
  },
  closeBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});

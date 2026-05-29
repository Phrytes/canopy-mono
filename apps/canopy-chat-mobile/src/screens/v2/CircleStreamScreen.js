/**
 * canopy-chat-mobile v2 — cross-circle Stream (RN screen, board 5B).
 *
 * RN counterpart of web's circleStream over the SAME shared projection
 * (`buildCircleStream`): one timeline interleaving every circle's inbound
 * events by time, each row carrying a circle-tag.  Reads the shared
 * EventLog (lifted to App.js in M1) — an unfiltered projection, no
 * per-circle filter.  Tapping a circle-tagged row jumps to that circle.
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { buildCircleStream } from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';

export default function CircleStreamScreen({ eventLog, circles = [], onBack, onOpenCircle }) {
  const rows = useMemo(() => {
    const events = eventLog?.query ? eventLog.query({ excludeMuted: true }) : [];
    return buildCircleStream({ events, circles });
  }, [eventLog, circles]);

  return (
    <View style={styles.page} testID="circle-stream">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-stream-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.stream.title')}</Text>

      {rows.length === 0 ? (
        <Text style={styles.muted}>{t('circle.stream.empty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rows.map((row) => {
            const tappable = !!row.circleId;
            const Row = (
              <>
                <Text style={styles.tag}>{row.circleName || t('circle.stream.untagged')}</Text>
                <Text style={styles.body}>{[row.app, row.type].filter(Boolean).join(' · ')}</Text>
                <Text style={styles.when}>{formatTs(row.ts)}</Text>
              </>
            );
            return tappable ? (
              <Pressable
                key={row.id}
                style={styles.row}
                accessibilityRole="button"
                testID={`stream-row-${row.id}`}
                onPress={() => onOpenCircle?.(row.circleId)}
              >
                {Row}
              </Pressable>
            ) : (
              <View key={row.id} style={styles.row} testID={`stream-row-${row.id}`}>{Row}</View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function formatTs(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString(); } catch { return ''; }
}

const styles = StyleSheet.create({
  page:   { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#fdfaf1' },
  bar:    { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:   { fontSize: 13, color: '#6a6a6a' },
  title:  { fontSize: 20, fontWeight: '600', marginVertical: 10 },
  list:   { gap: 6, paddingBottom: 32 },
  row:    { padding: 12, borderWidth: 1, borderColor: '#e6e0cf', borderRadius: 8, backgroundColor: '#fbf8ed' },
  tag:    { fontSize: 11, fontWeight: '700', color: '#8a6d1f' },
  body:   { fontSize: 14, color: '#1a1a1a', marginTop: 2 },
  when:   { fontSize: 11, color: '#9a9a9a', marginTop: 2 },
  muted:  { color: '#6a6a6a', fontStyle: 'italic', paddingVertical: 10 },
});

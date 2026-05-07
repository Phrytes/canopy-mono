/**
 * LogPane — unified scrollable log for ALL scenarios.
 *
 * Receives an array of `{ ts, scenarioId, line }` entries from App.js
 * (the parent owns the buffer; rows just append to it).  Auto-scrolls
 * to the bottom whenever new lines arrive.  Has a Clear button so the
 * user can reset the buffer between runs.
 */
import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export function LogPane({ entries, onClear }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      // Defer to the next tick so the new line is laid out before we scroll.
      setTimeout(() => ref.current?.scrollToEnd?.({ animated: false }), 0);
    }
  }, [entries.length]);

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Text style={styles.headerText}>
          Logs ({entries.length})
        </Text>
        <Pressable
          style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.7 }]}
          onPress={onClear}
        >
          <Text style={styles.clearBtnText}>Clear</Text>
        </Pressable>
      </View>
      <ScrollView ref={ref} style={styles.root} contentContainerStyle={styles.content}>
        {entries.length === 0 ? (
          <Text style={styles.emptyText}>(no log entries yet — press Run on a scenario)</Text>
        ) : (
          entries.map((e, i) => (
            <Text key={i} style={styles.line} selectable>
              <Text style={styles.ts}>{formatTs(e.ts)}</Text>
              {' '}
              <Text style={styles.id}>[{e.scenarioId}]</Text>
              {' '}{e.line}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function formatTs(ts) {
  // hh:mm:ss.mmm — short enough not to dominate; long enough to align
  // with relay [verbose] output's clock.
  const d = new Date(ts);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const styles = StyleSheet.create({
  wrapper:       { flex: 1, marginTop: 8 },
  header:        {
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  headerText:    { color: '#8c93b8', fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  clearBtn:      { backgroundColor: '#262a36', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  clearBtnText:  { color: '#d4d8f0', fontSize: 12, fontWeight: '600' },
  root:          { flex: 1, backgroundColor: '#0b0d13', borderRadius: 6 },
  content:       { padding: 8 },
  line:          { color: '#d4d8f0', fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
  ts:            { color: '#6b7094' },
  id:            { color: '#7a86c0', fontWeight: '700' },
  emptyText:     { color: '#6b7094', fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 8 },
});

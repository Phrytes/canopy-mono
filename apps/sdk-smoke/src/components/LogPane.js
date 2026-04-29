/**
 * LogPane — scrollable, monospace log buffer for one scenario.
 *
 * Receives an array of `{ ts, line }` entries from the parent ScenarioRow.
 * Auto-scrolls to the bottom whenever new lines arrive.  Toggle visible
 * via the parent's "log" button so the harness stays compact when
 * everything is `pending`.
 */
import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export function LogPane({ entries }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      // Defer to the next tick so the new line is laid out before we scroll.
      setTimeout(() => ref.current?.scrollToEnd?.({ animated: false }), 0);
    }
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>(no log entries yet)</Text>
      </View>
    );
  }

  return (
    <ScrollView ref={ref} style={styles.root} contentContainerStyle={styles.content}>
      {entries.map((e, i) => (
        <Text key={i} style={styles.line} selectable>
          <Text style={styles.ts}>{formatTs(e.ts)}</Text>
          {' '}{e.line}
        </Text>
      ))}
    </ScrollView>
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
  root:      { backgroundColor: '#0b0d13', borderRadius: 6, maxHeight: 200, marginTop: 6 },
  content:   { padding: 8 },
  line:      { color: '#d4d8f0', fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
  ts:        { color: '#6b7094' },
  empty:     { backgroundColor: '#0b0d13', borderRadius: 6, padding: 12, marginTop: 6 },
  emptyText: { color: '#6b7094', fontSize: 12, fontStyle: 'italic' },
});

/**
 * CircleRecordScreen — RN renderer for a `shape:'record'` manifest view
 * (Q17), e.g. the agents app's read-only `agent-detail` (`viewAgent` +
 * `argsFromContext: {agentId: '$agentId'}`).  Twin of web's
 * `web/v2/recordScreen.js`.
 *
 * RN-only glue (invariant #1): the record itself is extracted from the
 * skill reply by shared `recordFromReply` and formatted by the portable
 * `recordFields` model (src/core/screenPanelDrilldown.js); this component
 * just lays the key→value pairs out.  No new user-facing strings — the
 * empty state reuses the panel's existing `circle.screen.empty` key
 * (invariant #8), exactly like web.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import { t } from '../../core/localisation.js';
import { recordFields } from '../../core/screenPanelDrilldown.js';

export default function CircleRecordScreen({ record }) {
  const fields = recordFields(record);
  if (!fields.length) {
    return (
      <View testID="circle-record-screen-empty">
        <Text style={styles.empty}>{t('circle.screen.empty')}</Text>
      </View>
    );
  }
  return (
    <View testID="circle-record-screen">
      {fields.map(({ key, text }) => (
        <View key={key} style={styles.field} testID={`record-field-${key}`}>
          <Text style={styles.key}>{key}</Text>
          <Text style={styles.value}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: theme.color.inkSoft, fontStyle: 'italic', textAlign: 'center', paddingVertical: 24, paddingHorizontal: 12 },
  field: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  key:   { fontSize: 11, fontWeight: '700', color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  value: { fontSize: 14, color: theme.color.ink, lineHeight: 20 },
});

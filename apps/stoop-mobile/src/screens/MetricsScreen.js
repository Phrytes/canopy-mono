/**
 * MetricsScreen — debug / admin metrics view.
 *
 * Stoop V3 mobile.  Out-of-scope for the V3 user release; this
 * screen exists so the navigation stack is complete.  Bring-up code
 * may inject the live `UsageMetrics` snapshot via props.
 */

import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/localisation.js';

/**
 * @param {object} props
 * @param {object} [props.snapshot]   `{counters: {...}, gauges: {...}}`
 */
export function MetricsScreen({ snapshot } = {}) {
  if (!snapshot) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('metrics.unavailable',
             'Statistieken zijn niet aangesloten in deze build.')}
        </Text>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>{t('metrics.heading', 'Statistieken')}</Text>
      {Object.entries(snapshot).map(([section, values]) => (
        <View key={section} style={styles.section}>
          <Text style={styles.sectionTitle}>{section}</Text>
          {Object.entries(values ?? {}).map(([k, v]) => (
            <View key={k} style={styles.row}>
              <Text style={styles.rowKey}>{k}</Text>
              <Text style={styles.rowVal}>{String(v)}</Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

export default MetricsScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  section: {
    marginBottom: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  sectionTitle: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowKey: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
  rowVal: { color: COLORS.text,      fontSize: FONT_SIZES.sm, fontFamily: 'monospace' },
  empty:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted, textAlign: 'center' },
});

/**
 * basis-mobile v2 — skill match list (RN screen, board 8).
 *
 * RN counterpart of web's circleOfferingMatches over the SAME shared projection
 * (`buildOfferingMatches`): one row per INJECTED match, each carrying a label +
 * a source badge (human / agent / via-hop). The host supplies the matches;
 * no fetching or local discovery happens here. Mirrors CircleStreamScreen.
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import { buildOfferingMatches } from '@onderling-app/basis';
import { t } from '../../core/localisation.js';

export default function CircleOfferingMatchesScreen({ matches = [], onBack }) {
  const rows = useMemo(() => buildOfferingMatches({ matches }), [matches]);

  return (
    <View style={styles.page} testID="circle-offering-matches">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-offering-matches-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.offerings.matches_title')}</Text>

      {rows.length === 0 ? (
        <Text style={styles.muted}>{t('circle.offerings.no_matches')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rows.map((row) => (
            <View key={row.id} style={styles.row} testID={`skill-match-${row.id}`}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={styles.badge}>{t(`circle.offerings.source.${row.source}`)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page:   { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:    { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:   { fontSize: 13, color: theme.color.inkSoft },
  title:  { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  list:   { gap: 6, paddingBottom: 32 },
  row:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card },
  label:  { fontSize: 14, color: theme.color.ink, flexShrink: 1, paddingRight: 8 },
  badge:  { fontSize: 11, fontWeight: '700', color: theme.color.inkSoft },
  muted:  { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
});

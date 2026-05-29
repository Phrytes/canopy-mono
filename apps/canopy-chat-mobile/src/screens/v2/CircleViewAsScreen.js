/**
 * canopy-chat-mobile v2 — "View as…" preview (RN screen, board 4C).
 *
 * RN counterpart of web's circleViewAs over the SAME shared projection
 * (`viewAsDirectory`): pick a viewer (each member, plus a generic stranger
 * / agent) and the directory re-renders showing what that viewer would see
 * under the circle's reveal policy. Pure projection — the host passes the
 * member list + policy (members come from the identity-resolver MemberMap
 * once an op surfaces it; empty until then).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { viewAsDirectory } from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';

export default function CircleViewAsScreen({ members = [], policy = 'pairwise', onBack }) {
  const [viewer, setViewer] = useState({ kind: 'stranger' });

  const chips = useMemo(() => ([
    ...members.map((m) => ({ id: m.id, kind: 'member', label: m.handle || m.id })),
    { kind: 'stranger', label: t('circle.viewAs.stranger') },
    { kind: 'agent',    label: t('circle.viewAs.agent') },
  ]), [members]);

  const rows = useMemo(() => viewAsDirectory({ members, viewer, policy }), [members, viewer, policy]);

  return (
    <View style={styles.page} testID="circle-viewas">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-viewas-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.viewAs.title')}</Text>

      <View style={styles.picker}>
        {chips.map((c) => {
          const active = c.kind === viewer.kind && (c.kind !== 'member' || c.id === viewer.id);
          return (
            <Pressable
              key={`${c.kind}:${c.id ?? ''}`}
              onPress={() => setViewer({ id: c.id, kind: c.kind })}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              testID={`viewas-viewer-${c.id ?? c.kind}`}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {rows.length === 0 ? (
        <Text style={styles.muted}>{t('circle.viewAs.empty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rows.map((r) => (
            <View key={r.id} style={styles.row} testID={`viewas-row-${r.id}`}>
              <Text style={styles.name}>{r.displayName}</Text>
              <Text style={styles.badge}>
                {r.revealed ? t('circle.viewAs.revealed') : t('circle.viewAs.hidden')}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page:        { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#fdfaf1' },
  bar:         { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:        { fontSize: 13, color: '#6a6a6a' },
  title:       { fontSize: 20, fontWeight: '600', marginVertical: 10 },
  picker:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip:        { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: '#d8d2c0', backgroundColor: '#fbf8ed' },
  chipActive:  { borderColor: '#c9a13a', backgroundColor: '#c9a13a' },
  chipText:    { fontSize: 12, color: '#6a6a6a' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  list:        { gap: 6, paddingBottom: 32 },
  row:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderWidth: 1, borderColor: '#e6e0cf', borderRadius: 8, backgroundColor: '#fbf8ed' },
  name:        { fontSize: 14, color: '#1a1a1a' },
  badge:       { fontSize: 11, color: '#8a6d1f' },
  muted:       { color: '#6a6a6a', fontStyle: 'italic', paddingVertical: 10 },
});

/**
 * canopy-chat-mobile v2 — personal circle override (RN screen, board 6A · M3).
 *
 * RN counterpart of web's circleOverride renderer over the SAME shared
 * `memberOverride` model: the calling member's deviations from a circle's
 * defaults — chat off / reveal-open / agents-may-contact-me + flow-through
 * (claimed tasks / calendar → "My things").  Loads/saves through the
 * injected override store (AsyncStorage-backed).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, StyleSheet } from 'react-native';
import { mergeMemberOverride } from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';

const TOP_TOGGLES = ['chatOff', 'revealOpen', 'agentsMayContactMe'];
const FLOW_TOGGLES = ['tasksToPersonal', 'calendarToPersonal'];

export default function CircleOverrideScreen({ store, circleId, onBack }) {
  const [working, setWorking] = useState(null);

  useEffect(() => {
    let live = true;
    store.get(circleId).then((o) => { if (live) setWorking(o); });
    return () => { live = false; };
  }, [store, circleId]);

  const patch = useCallback((p) => setWorking((cur) => mergeMemberOverride(cur, p)), []);

  const onSave = useCallback(async () => {
    if (!working) return;
    await store.update(circleId, working);
    onBack?.();
  }, [working, store, circleId, onBack]);

  if (!working) {
    return (
      <View style={styles.page} testID="circle-override">
        <Text style={styles.muted}>{t('circle.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.page} testID="circle-override">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-override-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.override.title')}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        {TOP_TOGGLES.map((key) => (
          <View key={key} style={styles.row}>
            <Text style={styles.rowLabel}>{t(`circle.override.${key}`)}</Text>
            <Switch
              value={!!working[key]}
              onValueChange={(v) => patch({ [key]: v })}
              testID={`override-${key}`}
            />
          </View>
        ))}

        <Text style={styles.section}>{t('circle.override.flowThrough')}</Text>
        {FLOW_TOGGLES.map((key) => (
          <View key={key} style={styles.row}>
            <Text style={styles.rowLabel}>{t(`circle.override.${key}`)}</Text>
            <Switch
              value={!!working.flowThrough?.[key]}
              onValueChange={(v) => patch({ flowThrough: { [key]: v } })}
              testID={`override-${key}`}
            />
          </View>
        ))}
      </ScrollView>

      <Pressable style={styles.save} onPress={onSave} accessibilityRole="button" testID="circle-override-save">
        <Text style={styles.saveText}>{t('circle.settings.save')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page:     { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#fdfaf1' },
  bar:      { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:     { fontSize: 13, color: '#6a6a6a' },
  title:    { fontSize: 20, fontWeight: '600', marginVertical: 10 },
  body:     { paddingBottom: 24 },
  section:  { fontSize: 13, fontWeight: '700', color: '#8a6d1f', marginTop: 16, marginBottom: 4 },
  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  rowLabel: { fontSize: 14, color: '#1a1a1a', flexShrink: 1, paddingRight: 8 },
  muted:    { color: '#6a6a6a', fontStyle: 'italic', paddingVertical: 10 },
  save:     { marginTop: 8, marginBottom: 12, padding: 13, borderRadius: 8, backgroundColor: '#c9a13a', alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

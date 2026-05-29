/**
 * canopy-chat-mobile v2 — availability (RN screen, board 6C · M3).
 *
 * RN counterpart of web's circleAvailability renderer over the SAME shared
 * `memberAvailability` model: cross-circle holiday mode (away until a date)
 * + quiet hours (defer pushes in a daily window, optionally weekends all
 * day).  Loads/saves through the injected (keyless) availability store.
 *
 * Web uses native date/time inputs; RN has none, so the date (YYYY-MM-DD)
 * and times (HH:MM) are plain TextInputs.  Working state is held RAW while
 * editing — the store's mergeAvailability normalises on save (a malformed
 * time falls back to the model default rather than blocking each keystroke).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, TextInput, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';

export default function CircleAvailabilityScreen({ store, onBack }) {
  const [working, setWorking] = useState(null);

  useEffect(() => {
    let live = true;
    store.get().then((a) => { if (live) setWorking(a); });
    return () => { live = false; };
  }, [store]);

  const setHoliday = useCallback((p) => setWorking((w) => ({ ...w, holiday: { ...w.holiday, ...p } })), []);
  const setQuiet   = useCallback((p) => setWorking((w) => ({ ...w, quietHours: { ...w.quietHours, ...p } })), []);

  const onSave = useCallback(async () => {
    if (!working) return;
    // store.update → mergeAvailability normalises (rejects malformed times).
    await store.update(working);
    onBack?.();
  }, [working, store, onBack]);

  if (!working) {
    return (
      <View style={styles.page} testID="circle-availability">
        <Text style={styles.muted}>{t('circle.loading')}</Text>
      </View>
    );
  }

  const h = working.holiday || {};
  const q = working.quietHours || {};

  return (
    <View style={styles.page} testID="circle-availability">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-availability-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.availability.title')}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>{t('circle.availability.holiday')}</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('circle.availability.holiday_on')}</Text>
          <Switch value={!!h.active} onValueChange={(v) => setHoliday({ active: v })} testID="holiday-active" />
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.rowLabel}>{t('circle.availability.holiday_until')}</Text>
          <TextInput
            style={styles.input}
            value={h.until || ''}
            onChangeText={(v) => setHoliday({ until: v || null })}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            autoCorrect={false}
            testID="holiday-until"
          />
        </View>

        <Text style={styles.section}>{t('circle.availability.quietHours')}</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('circle.availability.quiet_on')}</Text>
          <Switch value={!!q.enabled} onValueChange={(v) => setQuiet({ enabled: v })} testID="quiet-enabled" />
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.rowLabel}>{t('circle.availability.from')}</Text>
          <TextInput
            style={styles.input}
            value={q.from || ''}
            onChangeText={(v) => setQuiet({ from: v })}
            placeholder="HH:MM"
            autoCapitalize="none"
            autoCorrect={false}
            testID="quiet-from"
          />
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.rowLabel}>{t('circle.availability.to')}</Text>
          <TextInput
            style={styles.input}
            value={q.to || ''}
            onChangeText={(v) => setQuiet({ to: v })}
            placeholder="HH:MM"
            autoCapitalize="none"
            autoCorrect={false}
            testID="quiet-to"
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('circle.availability.weekends')}</Text>
          <Switch value={!!q.weekends} onValueChange={(v) => setQuiet({ weekends: v })} testID="quiet-weekends" />
        </View>
      </ScrollView>

      <Pressable style={styles.save} onPress={onSave} accessibilityRole="button" testID="circle-availability-save">
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
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  rowLabel: { fontSize: 14, color: '#1a1a1a', flexShrink: 1, paddingRight: 8 },
  input:    { width: 130, padding: 9, borderWidth: 1, borderColor: '#c9a13a', borderRadius: 8, backgroundColor: '#fff', fontSize: 14, textAlign: 'center' },
  muted:    { color: '#6a6a6a', fontStyle: 'italic', paddingVertical: 10 },
  save:     { marginTop: 8, marginBottom: 12, padding: 13, borderRadius: 8, backgroundColor: '#c9a13a', alignItems: 'center' },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

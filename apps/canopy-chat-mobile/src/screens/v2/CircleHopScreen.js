/**
 * canopy-chat-mobile v2 — hopping (RN screen, board 7).
 *
 * RN counterpart of web's circleHop: the device-global hop stance toggle,
 * backed by Stoop's getHopMode / setHopMode (read on mount, flipped on
 * toggle). Per-contact hop flags + the hop-match card chain live in Stoop /
 * land later; this surfaces the global stance + explains hopping.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Switch, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import { normalizeHopMode } from '@onderling-app/canopy-chat';
import { t } from '../../core/localisation.js';

export default function CircleHopScreen({ callSkill, onBack }) {
  const [hopMode, setHopMode] = useState({ global: false });

  useEffect(() => {
    let live = true;
    (async () => {
      if (!callSkill) return;
      try {
        const r = await callSkill('getHopMode', {});
        if (live && r) setHopMode(normalizeHopMode(r));
      } catch { /* keep default */ }
    })();
    return () => { live = false; };
  }, [callSkill]);

  const onToggle = useCallback(async (v) => {
    setHopMode({ global: v });   // optimistic
    if (!callSkill) return;
    try {
      const r = await callSkill('setHopMode', { global: v });
      if (r && !r.error) setHopMode(normalizeHopMode(r));
    } catch { /* leave optimistic value */ }
  }, [callSkill]);

  return (
    <View style={styles.page} testID="circle-hop">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-hop-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.hop.title')}</Text>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>{t('circle.hop.global_label')}</Text>
        <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white} value={!!hopMode.global} onValueChange={onToggle} testID="circle-hop-global" />
      </View>
      <Text style={styles.explain}>{t('circle.hop.explain')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page:     { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:      { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:     { fontSize: 13, color: theme.color.inkSoft },
  title:    { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  rowLabel: { fontSize: 14, color: theme.color.ink, flexShrink: 1, paddingRight: 8 },
  explain:  { fontSize: 13, color: theme.color.inkSoft, lineHeight: 19, marginTop: 8 },
});

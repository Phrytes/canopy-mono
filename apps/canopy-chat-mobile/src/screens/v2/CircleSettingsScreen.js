/**
 * canopy-chat-mobile v2 — circle settings (RN screen, board 4A · M3).
 *
 * RN counterpart of web's circleSettings renderer over the SAME shared
 * model (`@canopy-app/canopy-chat`): 5 policy axes (feature toggles + 4
 * enum radio groups) + the co-admin consensus toggle + per-option
 * consequence panels (1.2b).  Loads/saves through the injected policy
 * store (AsyncStorage-backed).  When consensus is active (consensusRequired
 * + ≥2 admins) Save records a pending proposal instead of applying.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import {
  CIRCLE_FEATURES, CIRCLE_POLICY_ENUMS, mergeCirclePolicy, makeProposal,
} from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';

const ENUM_AXES = ['llmTool', 'agents', 'revealPolicy', 'pod'];

export default function CircleSettingsScreen({ store, circleId, onBack }) {
  const [working, setWorking] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    let live = true;
    store.get(circleId).then((p) => { if (live) setWorking(p); });
    return () => { live = false; };
  }, [store, circleId]);

  const patch = useCallback((p) => setWorking((cur) => mergeCirclePolicy(cur, p)), []);

  const consensusActive = !!working?.consensusRequired && (working?.admins?.length ?? 0) >= 2;

  const onSave = useCallback(async () => {
    if (!working) return;
    if (consensusActive) {
      // Cross-admin delivery (reuse the groupRedeem envelope) lands in
      // 1.3b — here we record the pending proposal locally.
      makeProposal({ circleId, patch: working, proposedBy: null, policy: working });
    } else {
      await store.update(circleId, working);
    }
    onBack?.();
  }, [working, consensusActive, store, circleId, onBack]);

  if (!working) {
    return (
      <View style={styles.page} testID="circle-settings">
        <Text style={styles.muted}>{t('circle.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.page} testID="circle-settings">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-settings-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.settings.title')}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>{t('circle.settings.features')}</Text>
        {CIRCLE_FEATURES.map((f) => (
          <View key={f} style={styles.row}>
            <Text style={styles.rowLabel}>{t(`circle.settings.feat.${f}`)}</Text>
            <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
              value={!!working.features?.[f]}
              onValueChange={(v) => patch({ features: { [f]: v } })}
              testID={`feat-${f}`}
            />
          </View>
        ))}

        {ENUM_AXES.map((axis) => (
          <View key={axis}>
            <Text style={styles.section}>{t(`circle.settings.${axis}`)}</Text>
            {CIRCLE_POLICY_ENUMS[axis].map((opt) => {
              const consKey = `circle.settings.consequence.${opt}`;
              const consText = t(consKey);
              const hasCons = consText && consText !== consKey;
              const selected = working[axis] === opt;
              return (
                <View key={opt}>
                  <View style={styles.optRow}>
                    <Pressable
                      style={styles.optTap}
                      onPress={() => patch({ [axis]: opt })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      testID={`opt-${opt}`}
                    >
                      <View style={[styles.radio, selected && styles.radioOn]}>
                        {selected ? <View style={styles.radioDot} /> : null}
                      </View>
                      <Text style={styles.rowLabel}>{t(`circle.settings.opt.${opt}`)}</Text>
                    </Pressable>
                    {hasCons ? (
                      <Pressable
                        onPress={() => setExpanded((e) => ({ ...e, [opt]: !e[opt] }))}
                        accessibilityRole="button"
                        accessibilityLabel={t('circle.settings.consequence_aria')}
                        testID={`info-${opt}`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.info}>ⓘ</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {hasCons && expanded[opt] ? (
                    <Text style={styles.consequence} testID={`consequence-${opt}`}>{consText}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}

        <Text style={styles.section}>{t('circle.settings.consensus')}</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('circle.settings.consensus_label')}</Text>
          <Switch trackColor={{ true: theme.color.accent, false: theme.color.trackOff }} thumbColor={theme.color.white}
            value={!!working.consensusRequired}
            onValueChange={(v) => patch({ consensusRequired: v })}
            testID="consensusRequired"
          />
        </View>
        {consensusActive ? <Text style={styles.note}>{t('circle.settings.pending')}</Text> : null}
      </ScrollView>

      <Pressable style={styles.save} onPress={onSave} accessibilityRole="button" testID="circle-settings-save">
        <Text style={styles.saveText}>
          {consensusActive ? t('circle.settings.send_proposal') : t('circle.settings.save')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page:        { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:         { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:        { fontSize: 13, color: theme.color.inkSoft },
  title:       { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  body:        { paddingBottom: 24 },
  section:     { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: theme.color.inkSoft, marginTop: 16, marginBottom: 4 },
  row:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 },
  rowLabel:    { fontSize: 14, color: theme.color.ink, flexShrink: 1, paddingRight: 8 },
  optRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  optTap:      { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  radio:       { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.color.accent, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  radioOn:     { borderColor: theme.color.accent },
  radioDot:    { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.color.accent },
  info:        { fontSize: 16, color: theme.color.inkSoft, paddingHorizontal: 6 },
  consequence: { fontSize: 12, color: theme.color.inkSoft, backgroundColor: theme.color.paper2, borderRadius: 6, padding: 8, marginBottom: 6 },
  note:        { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic', marginTop: 8 },
  muted:       { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  save:        { marginTop: 8, marginBottom: 12, padding: 13, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  saveText:    { color: theme.color.white, fontSize: 15, fontWeight: '700' },
});

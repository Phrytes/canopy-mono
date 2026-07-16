/**
 * basis-mobile v2 — skill editor (RN screen, board 8).
 *
 * RN counterpart of web's circleSkillEditor over the SAME shared model
 * (`@onderling-app/basis`): the four skill axes (openness · posture ·
 * status · radius) as single-choice radio rows. Holds a working copy via
 * `mergeSkill`; Save returns it to the host, Back discards. Local discovery
 * is out of scope for this slice.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import { SKILL_AXES, DEFAULT_SKILL, normalizeSkill, mergeSkill, consequenceKeyFor } from '@onderling-app/basis';
import { t } from '../../core/localisation.js';

const AXES = ['openness', 'posture', 'status', 'radius'];

export default function CircleSkillEditorScreen({ skill, onSave, onBack }) {
  const [working, setWorking] = useState(() => normalizeSkill(skill ?? DEFAULT_SKILL));
  // N2.b — which (axis-option) consequence note is open.
  const [openInfo, setOpenInfo] = useState(null);

  const patch = (p) => setWorking((cur) => mergeSkill(cur, p));

  return (
    <View style={styles.page} testID="circle-skill">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-skill-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.skills.editor_title')}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        {AXES.map((axis) => (
          <View key={axis}>
            <Text style={styles.section}>{t(`circle.skills.axis.${axis}`)}</Text>
            {SKILL_AXES[axis].map((opt) => {
              const selected = working[axis] === opt;
              const consKey = consequenceKeyFor(axis, opt);
              const infoKey = `${axis}.${opt}`;
              const open = openInfo === infoKey;
              return (
                <View key={opt}>
                  <View style={styles.optLine}>
                    <Pressable
                      style={styles.optRow}
                      onPress={() => patch({ [axis]: opt })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      testID={`skill-opt-${opt}`}
                    >
                      <View style={[styles.radio, selected && styles.radioOn]}>
                        {selected ? <View style={styles.radioDot} /> : null}
                      </View>
                      <Text style={styles.rowLabel}>{t(`circle.skills.opt.${opt}`)}</Text>
                    </Pressable>
                    {consKey ? (
                      <Pressable
                        onPress={() => setOpenInfo(open ? null : infoKey)}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.consequences')}
                        accessibilityState={{ expanded: open }}
                        testID={`skill-info-${opt}`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.info}>ⓘ</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {consKey && open ? (
                    <Text style={styles.consequence}>{t(consKey)}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <Pressable
        style={styles.save}
        onPress={() => onSave?.(working)}
        accessibilityRole="button"
        testID="circle-skill-save"
      >
        <Text style={styles.saveText}>{t('circle.settings.save')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page:      { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:       { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:      { fontSize: 13, color: theme.color.inkSoft },
  title:     { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  body:      { paddingBottom: 24 },
  section:   { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: theme.color.inkSoft, marginTop: 16, marginBottom: 4 },
  optLine:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, flex: 1 },
  info:      { fontSize: 15, color: theme.color.accent, paddingHorizontal: 6 },
  consequence: { fontSize: 12, lineHeight: 17, color: theme.color.inkSoft, marginLeft: 28, marginBottom: 6, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: theme.color.line ?? '#ddd' },
  radio:     { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.color.accent, marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  radioOn:   { borderColor: theme.color.accent },
  radioDot:  { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.color.accent },
  rowLabel:  { fontSize: 14, color: theme.color.ink, flexShrink: 1, paddingRight: 8 },
  save:      { marginTop: 8, marginBottom: 12, padding: 13, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  saveText:  { color: theme.color.white, fontSize: 15, fontWeight: '700' },
});

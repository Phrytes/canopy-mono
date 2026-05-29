/**
 * canopy-chat-mobile v2 — skill editor (RN screen, board 8).
 *
 * RN counterpart of web's circleSkillEditor over the SAME shared model
 * (`@canopy-app/canopy-chat`): the four skill axes (openness · posture ·
 * status · radius) as single-choice radio rows. Holds a working copy via
 * `mergeSkill`; Save returns it to the host, Back discards. Local discovery
 * is out of scope for this slice.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SKILL_AXES, DEFAULT_SKILL, normalizeSkill, mergeSkill } from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';

const AXES = ['openness', 'posture', 'status', 'radius'];

export default function CircleSkillEditorScreen({ skill, onSave, onBack }) {
  const [working, setWorking] = useState(() => normalizeSkill(skill ?? DEFAULT_SKILL));

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
              return (
                <Pressable
                  key={opt}
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
  page:      { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#fdfaf1' },
  bar:       { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:      { fontSize: 13, color: '#6a6a6a' },
  title:     { fontSize: 20, fontWeight: '600', marginVertical: 10 },
  body:      { paddingBottom: 24 },
  section:   { fontSize: 13, fontWeight: '700', color: '#8a6d1f', marginTop: 16, marginBottom: 4 },
  optRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  radio:     { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#c9a13a', marginRight: 10, alignItems: 'center', justifyContent: 'center' },
  radioOn:   { borderColor: '#c9a13a' },
  radioDot:  { width: 9, height: 9, borderRadius: 5, backgroundColor: '#c9a13a' },
  rowLabel:  { fontSize: 14, color: '#1a1a1a', flexShrink: 1, paddingRight: 8 },
  save:      { marginTop: 8, marginBottom: 12, padding: 13, borderRadius: 8, backgroundColor: '#c9a13a', alignItems: 'center' },
  saveText:  { color: '#fff', fontSize: 15, fontWeight: '700' },
});

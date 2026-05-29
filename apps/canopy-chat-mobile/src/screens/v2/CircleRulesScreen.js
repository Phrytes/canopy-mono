/**
 * canopy-chat-mobile v2 — circle rules editor (RN screen, board 3B).
 *
 * RN counterpart of web's circleRulesEditor: the six governance questions
 * over a rules document; required questions (purpose + agreements) gate
 * Save. "Preview" shows the assembled doc as a joiner consents to it. Holds
 * a working copy seeded from the passed `doc`; the host persists onSave.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import { RULES_QUESTIONS, normalizeRulesDoc, isRulesComplete } from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';

export default function CircleRulesScreen({ doc, onSave, onBack, onPreview }) {
  const [working, setWorking] = useState(() => normalizeRulesDoc(doc));
  const setField = useCallback((k, v) => setWorking((w) => ({ ...w, [k]: v })), []);
  const complete = isRulesComplete(working);

  return (
    <View style={styles.page} testID="circle-rules">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-rules-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.rules.title')}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        {RULES_QUESTIONS.map((q) => (
          <View key={q.key} style={styles.field}>
            <Text style={styles.q}>{t(`circle.rules.q.${q.key}`)}{q.required ? ' *' : ''}</Text>
            <TextInput
              style={styles.input}
              value={working[q.key]}
              onChangeText={(v) => setField(q.key, v)}
              multiline
              testID={`rules-input-${q.key}`}
            />
          </View>
        ))}
        {!complete ? <Text style={styles.note}>{t('circle.rules.required_note')}</Text> : null}
        <Pressable onPress={() => onPreview?.(working)} accessibilityRole="button" testID="circle-rules-preview" style={styles.preview}>
          <Text style={styles.previewText}>{t('circle.rules.preview')}</Text>
        </Pressable>
      </ScrollView>

      <Pressable
        onPress={() => { if (complete) onSave?.(working); }}
        accessibilityRole="button"
        testID="circle-rules-save"
        style={[styles.save, !complete && styles.saveDisabled]}
        disabled={!complete}
      >
        <Text style={styles.saveText}>{t('circle.rules.save')}</Text>
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
  field:       { marginBottom: 12 },
  q:           { fontSize: 13, fontWeight: '600', color: theme.color.ink, marginBottom: 4 },
  input:       { minHeight: 56, padding: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.white, fontSize: 14, textAlignVertical: 'top' },
  note:        { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic', marginTop: 4 },
  preview:     { marginTop: 12, padding: 10, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.line, alignItems: 'center' },
  previewText: { color: theme.color.inkSoft, fontSize: 13 },
  save:        { marginTop: 8, marginBottom: 12, padding: 13, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  saveDisabled:{ backgroundColor: theme.color.line },
  saveText:    { color: theme.color.white, fontSize: 15, fontWeight: '700' },
});

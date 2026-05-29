/**
 * canopy-chat-mobile v2 — circle rules consent (RN screen, board 3C).
 *
 * RN counterpart of web's circleRulesConsent: the assembled rules document
 * shown read-only with Agree / Decline; only non-blank fields render.
 * Reached as a preview from the editor (real join-flow consent is the
 * follow-on).
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { RULES_FIELDS, normalizeRulesDoc, isRulesEmpty } from '@canopy-app/canopy-chat';
import { t } from '../../core/localisation.js';

export default function CircleRulesConsentScreen({ doc, onAgree, onDecline, onBack }) {
  const d = normalizeRulesDoc(doc);
  const empty = isRulesEmpty(d);

  return (
    <View style={styles.page} testID="circle-rules-consent">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-rules-consent-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.rules.consent_title')}</Text>

      {empty ? (
        <Text style={styles.muted}>{t('circle.rules.consent_empty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {RULES_FIELDS.filter((k) => d[k].trim()).map((k) => (
            <View key={k} style={styles.field} testID={`consent-field-${k}`}>
              <Text style={styles.q}>{t(`circle.rules.q.${k}`)}</Text>
              <Text style={styles.a}>{d[k]}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.actions}>
        <Pressable onPress={onDecline} accessibilityRole="button" testID="circle-rules-decline" style={styles.decline}>
          <Text style={styles.declineText}>{t('circle.rules.decline')}</Text>
        </Pressable>
        <Pressable onPress={onAgree} accessibilityRole="button" testID="circle-rules-agree" style={styles.agree}>
          <Text style={styles.agreeText}>{t('circle.rules.agree')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page:        { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#fdfaf1' },
  bar:         { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:        { fontSize: 13, color: '#6a6a6a' },
  title:       { fontSize: 20, fontWeight: '600', marginVertical: 10 },
  body:        { paddingBottom: 16 },
  field:       { marginBottom: 14 },
  q:           { fontSize: 13, fontWeight: '700', color: '#8a6d1f' },
  a:           { fontSize: 14, color: '#1a1a1a', marginTop: 2, lineHeight: 20 },
  muted:       { color: '#6a6a6a', fontStyle: 'italic', paddingVertical: 10 },
  actions:     { flexDirection: 'row', gap: 10, marginBottom: 12 },
  decline:     { flex: 1, padding: 13, borderRadius: 8, borderWidth: 1, borderColor: '#d8d2c0', alignItems: 'center' },
  declineText: { color: '#6a6a6a', fontSize: 15 },
  agree:       { flex: 1, padding: 13, borderRadius: 8, backgroundColor: '#c9a13a', alignItems: 'center' },
  agreeText:   { color: '#fff', fontSize: 15, fontWeight: '700' },
});

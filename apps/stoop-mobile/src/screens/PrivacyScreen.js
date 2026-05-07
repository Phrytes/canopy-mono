/**
 * PrivacyScreen — static notice mirroring `/privacy.html`.
 *
 * Stoop V3 mobile.  Body text comes from the locale via the
 * `privacy.body_*` keys (already in stoop's locales).
 */

import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';

import { COLORS, SPACING, FONT_SIZES } from '../lib/theme.js';
import { t }                           from '../lib/i18n.js';

const SECTIONS = [
  { key: 'privacy.section_local',     fallback: 'Stoop draait op je toestel — er staat geen centrale server tussen.' },
  { key: 'privacy.section_pod',       fallback: 'Als je een Solid-pod koppelt, zie je daar je eigen data en wie er toegang heeft.' },
  { key: 'privacy.section_handles',   fallback: 'Anderen zien standaard alleen je @handle. Je kan een echte naam laten zien aan wie jij wilt.' },
  { key: 'privacy.section_location',  fallback: 'Je locatie wordt afgerond naar een 500m grid en alleen gedeeld als je dat aanzet.' },
  { key: 'privacy.section_no_thirdparty', fallback: 'Geen analytics, geen ad-trackers, geen cloud-providers behalve degene die jij kiest.' },
];

export function PrivacyScreen() {
  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>
        {t('privacy.heading', 'Privacy & veiligheid')}
      </Text>
      {SECTIONS.map((s) => (
        <View key={s.key} style={styles.section}>
          <Text style={styles.body}>{t(s.key, s.fallback)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

export default PrivacyScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: {
    fontSize: FONT_SIZES.xl, fontWeight: '600',
    color: COLORS.text, marginBottom: SPACING.lg,
  },
  section: { marginBottom: SPACING.md },
  body:    { fontSize: FONT_SIZES.md, color: COLORS.text, lineHeight: 22 },
});

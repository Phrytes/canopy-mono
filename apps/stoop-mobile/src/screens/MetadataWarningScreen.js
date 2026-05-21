/**
 * MetadataWarningScreen — first-launch privacy notice.
 *
 * Stoop V3 Phase 40.22 (2026-05-08).
 *
 * Shown once per fresh install: explains that the relay sees
 * **traffic metadata** (who you talk to, even if content is
 * encrypted), and offers an opt-out path to "use local-only" (skip
 * the relay; mDNS/BLE only). The user acknowledges → flag persists
 * via `markMetadataWarningSeen` → subsequent launches skip the
 * screen and go straight to Welcome.
 */

import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/localisation.js';
import { markMetadataWarningSeen }            from '../lib/metadataWarning.js';

export function MetadataWarningScreen() {
  const nav = useNavigation();
  const [busy, setBusy] = useState(false);

  const acknowledge = async () => {
    setBusy(true);
    try {
      await markMetadataWarningSeen();
    } finally {
      setBusy(false);
      nav.replace(ROUTES.Welcome);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.title}>
        {t('metadata_warning.heading',
           'Eén ding voordat je begint')}
      </Text>

      <Text style={styles.body}>
        {t('metadata_warning.intro',
           'Stoop draait lokaal op je toestel — er staat geen centrale server tussen jullie posts of berichten. Maar berichten reizen wel via een relay om bij elkaar te komen.')}
      </Text>

      <View style={styles.box}>
        <Text style={styles.boxHeading}>
          {t('metadata_warning.what_relay_sees',
             'Wat de relay wel ziet')}
        </Text>
        <Text style={styles.body}>
          {t('metadata_warning.what_relay_sees_body',
             'De inhoud van je berichten is versleuteld — die ziet de relay niet. Maar wel: \n• wie er met wie praat (metadata),\n• hoe vaak en wanneer.\n\nVergelijk het met de buitenkant van een envelop op de post: het adres en de afzender zijn zichtbaar, ook al is de brief gesloten.')}
        </Text>
      </View>

      <View style={styles.box}>
        <Text style={styles.boxHeading}>
          {t('metadata_warning.what_relay_does_not',
             'Wat de relay NIET ziet')}
        </Text>
        <Text style={styles.body}>
          {t('metadata_warning.what_relay_does_not_body',
             '• Je posts, foto\'s, chat-inhoud — versleuteld.\n• Je locatie tenzij je die expliciet deelt.\n• Je echte naam tenzij je die zelf onthult.\n\nGeen analytics, geen ad-trackers, geen cloud-providers buiten degene die jij kiest.')}
        </Text>
      </View>

      <View style={styles.box}>
        <Text style={styles.boxHeading}>
          {t('metadata_warning.what_you_can_do',
             'Wat je kan doen')}
        </Text>
        <Text style={styles.body}>
          {t('metadata_warning.what_you_can_do_body',
             '• Roteer regelmatig je netwerk-adres (Instellingen → Privacy).\n• Gebruik per-contact afspraken om wat je deelt te beperken.\n• Lokale modus (alleen mDNS/BLE) — je raakt buurtgenoten op hetzelfde wifi-netwerk maar niet daarbuiten.')}
        </Text>
      </View>

      <Pressable
        onPress={acknowledge}
        disabled={busy}
        style={styles.btnPrimary}
        accessibilityRole="button"
        accessibilityLabel="metadata-warning-acknowledge"
      >
        <Text style={styles.btnPrimaryLabel}>
          {busy
            ? t('metadata_warning.busy', 'Bezig…')
            : t('metadata_warning.acknowledge', 'Ik begrijp het — laten we beginnen')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

export default MetadataWarningScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  title: {
    fontSize: FONT_SIZES.xxl, fontWeight: '700', color: COLORS.text,
    marginTop: SPACING.lg, marginBottom: SPACING.lg,
  },
  body: { fontSize: FONT_SIZES.md, color: COLORS.text, lineHeight: 22 },
  box: {
    marginVertical: SPACING.md, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  boxHeading: {
    fontSize: FONT_SIZES.md, fontWeight: '600',
    color: COLORS.primary, marginBottom: SPACING.sm,
  },
  btnPrimary: {
    backgroundColor: COLORS.primary, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center', marginTop: SPACING.lg,
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
});

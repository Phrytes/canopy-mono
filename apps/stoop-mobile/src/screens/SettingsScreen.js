/**
 * SettingsScreen — two-section split per V3 functional design § 4g:
 *
 *   ── Shared (cross-device) ──
 *     handle, displayName, location.  Read-only here; edits land on
 *     ProfileMineScreen via the "Edit profile" link.
 *
 *   ── This device ──
 *     pollIntervalMs (default 5000 — battery-aware), onlineWindow.
 *
 * Stoop V3 mobile.  Pure UI: receives the two snapshots from
 * bring-up code; submits patches via `onUpdateDevice`.
 */

import React, { useState } from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/i18n.js';
import {
  coercePollInterval, MOBILE_DEFAULTS,
  POLL_INTERVAL_MIN_MS, POLL_INTERVAL_MAX_MS,
} from '../lib/settings.js';

/**
 * @param {object} props
 * @param {object} [props.shared]   `{handle, displayName, location}`
 * @param {object} [props.device]   `{pollIntervalMs, onlineWindow}`
 * @param {(patch: object) => Promise<void>} [props.onUpdateDevice]
 */
export function SettingsScreen({
  shared = {}, device = {}, onUpdateDevice,
} = {}) {
  const nav = useNavigation();
  const [pollInput, setPollInput] = useState(
    String(device.pollIntervalMs ?? MOBILE_DEFAULTS.pollIntervalMs),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const next = coercePollInterval(pollInput);
      if (onUpdateDevice) await onUpdateDevice({ pollIntervalMs: next });
      setPollInput(String(next));
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>{t('settings.heading', 'Instellingen')}</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t('settings.shared_heading', 'Gedeeld (alle toestellen)')}
        </Text>
        <KeyValue label={t('settings.handle', 'Handle')} value={shared.handle ? `@${shared.handle}` : '—'} />
        <KeyValue label={t('settings.display_name', 'Naam')} value={shared.displayName ?? '—'} />
        <KeyValue
          label={t('settings.location', 'Locatie')}
          value={shared.location?.cell ?? t('settings.location_unset', '—')}
        />

        <Pressable
          onPress={() => nav.navigate(ROUTES.ProfileMine)}
          style={styles.btnSecondary}
          accessibilityRole="button"
        >
          <Text style={styles.btnSecondaryLabel}>
            {t('settings.edit_profile', 'Bewerk profiel')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t('settings.device_heading', 'Dit toestel')}
        </Text>
        <Text style={styles.label}>{t('settings.poll_interval', 'Pollinterval (ms)')}</Text>
        <TextInput
          value={pollInput}
          onChangeText={setPollInput}
          keyboardType="numeric"
          style={styles.input}
          accessibilityLabel="settings-poll-input"
        />
        <Text style={styles.hint}>
          {t('settings.poll_hint',
             `Tussen {min}-{max} ms. Mobiel-default: {def} ms (batterijbewust).`)
            .replace('{min}', POLL_INTERVAL_MIN_MS.toString())
            .replace('{max}', POLL_INTERVAL_MAX_MS.toString())
            .replace('{def}', MOBILE_DEFAULTS.pollIntervalMs.toString())}
        </Text>

        <Pressable
          onPress={submit}
          disabled={busy}
          style={styles.btnPrimary}
          accessibilityRole="button"
          accessibilityLabel="settings-save"
        >
          <Text style={styles.btnPrimaryLabel}>
            {busy
              ? t('settings.saving', 'Opslaan…')
              : t('settings.save',   'Opslaan')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t('settings.privacy_heading', 'Privacy & meldingen')}
        </Text>
        <Pressable
          onPress={() => nav.navigate(ROUTES.Push)}
          style={styles.btnSecondary}
        >
          <Text style={styles.btnSecondaryLabel}>
            {t('settings.push_link', 'Meldingen')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => nav.navigate(ROUTES.Privacy)}
          style={styles.btnSecondary}
        >
          <Text style={styles.btnSecondaryLabel}>
            {t('settings.privacy_link', 'Privacy & veiligheid')}
          </Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

function KeyValue({ label, value }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
    </View>
  );
}

export default SettingsScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  section: {
    marginBottom: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.md, fontWeight: '600',
    color: COLORS.text, marginBottom: SPACING.md,
  },
  kv: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm },
  kvLabel: { flex: 1, fontSize: FONT_SIZES.sm, color: COLORS.textMuted },
  kvValue: { flex: 1, fontSize: FONT_SIZES.sm, color: COLORS.text, textAlign: 'right' },
  label: { fontSize: FONT_SIZES.sm, fontWeight: '500', color: COLORS.text, marginBottom: SPACING.xs },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
  },
  hint: { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: SPACING.xs },
  btnPrimary: {
    backgroundColor: COLORS.primary, paddingVertical: SPACING.md,
    borderRadius: RADII.sm, alignItems: 'center', marginTop: SPACING.md,
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted, paddingVertical: SPACING.md,
    borderRadius: RADII.sm, alignItems: 'center', marginTop: SPACING.sm,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },
});

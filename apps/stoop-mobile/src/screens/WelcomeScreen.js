/**
 * WelcomeScreen — Stoop V3 first-run.  Three CTAs:
 *   1. "New" — start fresh with a generated identity (no QR).
 *   2. "Restore" → OnboardRestoreScreen.
 *   3. "Scan QR" → OnboardScanScreen (camera).
 *
 * Locale keys live under `welcome.*` (added in this phase).
 *
 * The "New" CTA is intentionally first — most fresh installs don't
 * have a QR to scan and shouldn't be funneled through the camera.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { useNavigation } from '@react-navigation/native';

import { ROUTES }                         from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                              from '../lib/i18n.js';

export function WelcomeScreen() {
  const nav = useNavigation();

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <Text style={styles.brand}>{t('welcome.brand', 'Stoop')}</Text>
        <Text style={styles.tagline}>
          {t('welcome.tagline', 'Buurt-skill-app — vraag je buren om hulp.')}
        </Text>
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          label={t('welcome.cta_new', 'Beginnen')}
          onPress={() => nav.navigate(ROUTES.Shell, { screen: ROUTES.Feed, params: { firstRun: true } })}
          accessibilityLabel="welcome-new"
        />
        <SecondaryButton
          label={t('welcome.cta_scan', 'Scan QR-code')}
          onPress={() => nav.navigate(ROUTES.OnboardScan)}
          accessibilityLabel="welcome-scan"
        />
        <SecondaryButton
          label={t('welcome.cta_create_group', 'Maak een nieuwe groep')}
          onPress={() => nav.navigate(ROUTES.CreateGroup)}
          accessibilityLabel="welcome-create-group"
        />
        <SecondaryButton
          label={t('welcome.cta_restore', 'Herstel met herstelzin')}
          onPress={() => nav.navigate(ROUTES.OnboardRestore)}
          accessibilityLabel="welcome-restore"
        />
      </View>

      <Pressable
        style={styles.footerLink}
        onPress={() => nav.navigate(ROUTES.Privacy)}
        accessibilityRole="link"
      >
        <Text style={styles.footerLinkText}>
          {t('welcome.privacy_link', 'Privacy & veiligheid')}
        </Text>
      </Pressable>
    </View>
  );
}

function PrimaryButton({ label, onPress, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.btnPrimary, pressed && styles.pressed]}
    >
      <Text style={styles.btnPrimaryLabel}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.btnSecondary, pressed && styles.pressed]}
    >
      <Text style={styles.btnSecondaryLabel}>{label}</Text>
    </Pressable>
  );
}

export default WelcomeScreen;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: SPACING.xl,
    justifyContent: 'space-between',
  },
  hero: { marginTop: SPACING.xxl * 2, alignItems: 'center' },
  brand: {
    fontSize: FONT_SIZES.xxl + 12,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  tagline: {
    marginTop: SPACING.md,
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  actions: { marginVertical: SPACING.xxl },
  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg,
    borderRadius: RADII.md,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  btnPrimaryLabel: {
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  btnSecondary: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    paddingVertical: SPACING.lg,
    borderRadius: RADII.md,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  btnSecondaryLabel: {
    color: COLORS.text,
    fontSize: FONT_SIZES.md,
    fontWeight: '500',
  },
  pressed: { opacity: 0.85 },
  footerLink: { alignItems: 'center', paddingVertical: SPACING.lg },
  footerLinkText: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
});

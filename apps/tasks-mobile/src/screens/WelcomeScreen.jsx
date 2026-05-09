/**
 * WelcomeScreen — empty-state landing for first launch + after a
 * sign-out / leave-all-crews. Shows two onboarding paths:
 *
 *   1. Scan an invite QR  (→ ROUTES.OnboardScan)
 *   2. Restore from recovery phrase  (→ ROUTES.OnboardRestore)
 *
 * Phase 41.3.1 (2026-05-09).
 *
 * Issue (admin generates an invite for someone else) is reachable
 * from CrewSettings (Phase 41.8), not from Welcome — that flow only
 * makes sense once the user already has an admin role somewhere.
 */

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useI18n } from '../I18nProvider.js';
import { ROUTES } from '../navigation.js';

export function WelcomeScreen() {
  const nav = useNavigation();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        padding: SPACING.xl,
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontSize: FONT_SIZES.xxl,
          fontWeight: '600',
          color: COLORS.text,
          marginBottom: SPACING.md,
        }}
      >
        {t('mobile.welcome.title')}
      </Text>
      <Text
        style={{
          fontSize: FONT_SIZES.md,
          color: COLORS.textMuted,
          marginBottom: SPACING.xxl,
          lineHeight: 22,
        }}
      >
        {t('mobile.welcome.subtitle')}
      </Text>

      <Pressable
        onPress={() => nav.navigate(ROUTES.OnboardScan)}
        accessibilityRole="button"
        accessibilityLabel="welcome-scan-cta"
        style={({ pressed }) => [
          {
            backgroundColor: COLORS.primary,
            paddingVertical: SPACING.lg,
            paddingHorizontal: SPACING.lg,
            borderRadius: RADII.md,
            alignItems: 'center',
            marginBottom: SPACING.md,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text
          style={{
            color: COLORS.textInverse,
            fontSize: FONT_SIZES.md,
            fontWeight: '600',
          }}
        >
          {t('mobile.welcome.scan_cta')}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => nav.navigate(ROUTES.OnboardRestore)}
        accessibilityRole="button"
        accessibilityLabel="welcome-restore-cta"
        style={({ pressed }) => [
          {
            paddingVertical: SPACING.lg,
            paddingHorizontal: SPACING.lg,
            borderRadius: RADII.md,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: COLORS.surface,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text
          style={{
            color: COLORS.text,
            fontSize: FONT_SIZES.md,
            fontWeight: '500',
          }}
        >
          {t('mobile.welcome.restore_cta')}
        </Text>
      </Pressable>
    </View>
  );
}

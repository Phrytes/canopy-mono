/**
 * PrivacyScreen — render the closed-beta privacy notice.
 *
 * Phase 41.18.2 (2026-05-10).
 *
 * Wraps `getPrivacyNotice({lang})` from tasks-v0's crewControls
 * skills. Renders each item as a heading + paragraph block, mirroring
 * `apps/tasks-v0/web/privacy.html`. Picks the language from the active
 * Localisation locale.
 */

import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useSkillResult } from '../lib/useSkill.js';
import { useLocalisation }    from '../LocalisationProvider.js';

export function PrivacyScreen() {
  const nav = useNavigation();
  const { t, lang } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const result = useSkillResult('getPrivacyNotice', { lang }, [lang]);
  const items  = Array.isArray(result?.data?.items) ? result.data.items : [];

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg }}>
        <Text style={{
          fontSize: FONT_SIZES.lg, fontWeight: '600', color: COLORS.text,
          marginBottom: SPACING.md,
        }}>
          {t('mobile.privacy.title')}
        </Text>
        <Text style={{
          color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginBottom: SPACING.lg,
        }}>
          {t('mobile.privacy.intro')}
        </Text>

        {result?.error ? (
          <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm }}>
            {String(result.error?.message ?? result.error)}
          </Text>
        ) : null}

        {items.length === 0 && !result?.loading && !result?.error ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
            {t('mobile.privacy.empty')}
          </Text>
        ) : null}

        {items.map((it, idx) => (
          <View
            key={`${idx}-${it?.heading ?? ''}`}
            style={{
              marginBottom: SPACING.lg,
              padding: SPACING.md,
              backgroundColor: COLORS.surface,
              borderRadius: RADII.sm,
            }}
          >
            <Text style={{
              fontSize: FONT_SIZES.md, fontWeight: '600',
              color: COLORS.text, marginBottom: SPACING.sm,
            }}>
              {it?.heading ?? ''}
            </Text>
            <Text style={{
              fontSize: FONT_SIZES.sm, color: COLORS.text, lineHeight: 22,
            }}>
              {it?.body ?? ''}
            </Text>
          </View>
        ))}

        <Pressable
          onPress={() => nav.goBack()}
          accessibilityRole="button"
          accessibilityLabel="privacy-back"
          style={{
            marginTop: SPACING.md, alignSelf: 'flex-start',
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
            borderRadius: RADII.sm, borderWidth: 1, borderColor: COLORS.border,
          }}
        >
          <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md }}>
            {t('mobile.common.back')}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

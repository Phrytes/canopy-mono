/**
 * ProfileOtherScreen — read-only view of another member's profile.
 *
 * Phase 41.10 (2026-05-09).
 *
 * Resolves via the substrate's useMemberProfile hook (lifted in
 * Phase 41.0.b A7). Displays avatar, handle/displayName, skills.
 * No edit affordances — that's ProfileMineScreen.
 */

import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';

import { useTheme }     from '@canopy/react-native/theme';
import { AvatarCircle } from '@canopy/react-native/components';

import { useMemberProfile } from '../lib/useSkill.js';
import { useLocalisation }          from '../LocalisationProvider.js';

export function ProfileOtherScreen() {
  const route = useRoute();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const { pubKey, stableId, webid } = route?.params ?? {};
  const { member, loading, error } = useMemberProfile({ pubKey, stableId, webid });

  if (loading) {
    return (
      <View style={{ flex: 1, padding: SPACING.xl, backgroundColor: COLORS.background }}>
        <Text style={{ color: COLORS.textMuted }}>…</Text>
      </View>
    );
  }
  if (!member) {
    return (
      <View style={{ flex: 1, padding: SPACING.xl, backgroundColor: COLORS.background }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.md }}>
          {t('mobile.profile.unknown_member')}
        </Text>
        {error ? (
          <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.sm }}>
            {String(error?.message ?? error)}
          </Text>
        ) : null}
      </View>
    );
  }

  // Read-accept: prefer the new `offerings` field, fall back to legacy `skills`.
  const skills = Array.isArray(member?.offerings) ? member.offerings
    : (Array.isArray(member?.skills) ? member.skills : []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.xl, alignItems: 'center' }}
    >
      <AvatarCircle
        uri={member?.avatarUri ?? member?.avatarUrl ?? null}
        name={member?.displayName ?? member?.handle ?? ''}
        size={96}
      />
      <Text style={{
        marginTop: SPACING.md, fontSize: FONT_SIZES.lg, fontWeight: '600',
        color: COLORS.text, textAlign: 'center',
      }}>
        {member?.displayName ?? member?.handle ?? '—'}
      </Text>
      {member?.handle ? (
        <Text style={{
          marginTop: 4, fontSize: FONT_SIZES.sm, color: COLORS.textMuted,
        }}>
          @{member.handle}
        </Text>
      ) : null}

      {skills.length > 0 ? (
        <View style={{
          marginTop: SPACING.lg, alignSelf: 'stretch',
        }}>
          <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.text, fontWeight: '500', marginBottom: SPACING.sm }}>
            {t('mobile.profile.skills')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            {skills.map((s) => (
              <View
                key={s.categoryId ?? s.id ?? s.name}
                style={{
                  paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                  borderRadius: RADII.pill,
                  borderWidth: 1, borderColor: COLORS.border,
                  backgroundColor: COLORS.surface,
                }}
              >
                <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.xs }}>
                  #{s.categoryId ?? s.id ?? s.name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

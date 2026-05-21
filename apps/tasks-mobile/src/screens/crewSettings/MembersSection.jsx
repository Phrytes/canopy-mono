/**
 * MembersSection — read-only list of crew members + role chips.
 *
 * Phase 41.8.2 (2026-05-09).
 *
 * Reads members + roles from the active CrewState directly (no skill
 * round-trip — the data is already local). Tap a row → ProfileOther.
 */

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme }     from '@canopy/react-native/theme';
import { AvatarCircle } from '@canopy/react-native/components';

import { useService } from '../../ServiceContext.js';
import { useLocalisation }    from '../../LocalisationProvider.js';
import { ROUTES }     from '../../navigation.js';

export function MembersSection() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const cs = svc?.activeCrewId ? svc.crews.get(svc.activeCrewId) : null;
  const members = cs?.liveCrew?.members ?? [];

  if (members.length === 0) {
    return (
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
        {t('mobile.crew_settings.members_empty')}
      </Text>
    );
  }

  return (
    <View>
      {members.map((m) => (
        <Pressable
          key={m.webid}
          onPress={() => nav.navigate(ROUTES.ProfileOther, { webid: m.webid })}
          accessibilityRole="button"
          accessibilityLabel={`crew-settings-member-${m.webid}`}
          style={({ pressed }) => [
            {
              flexDirection: 'row', alignItems: 'center',
              paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
              borderRadius: RADII.sm,
              backgroundColor: COLORS.surface,
              borderWidth: 1, borderColor: COLORS.border,
              marginBottom: 4,
            },
            pressed && { opacity: 0.85 },
          ]}
        >
          <AvatarCircle name={m.displayName ?? m.webid} size={36} />
          <View style={{ flex: 1, marginLeft: SPACING.md }}>
            <Text
              numberOfLines={1}
              style={{ color: COLORS.text, fontSize: FONT_SIZES.sm, fontWeight: '500' }}
            >
              {m.displayName ?? _suffix(m.webid)}
            </Text>
            <Text
              numberOfLines={1}
              style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}
            >
              @{_suffix(m.webid)}
            </Text>
          </View>
          <View style={{
            paddingVertical: 2, paddingHorizontal: SPACING.sm,
            borderRadius: RADII.pill,
            backgroundColor: COLORS.surfaceMuted,
          }}>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}>
              {t(`mobile.crew_settings.role_${m.role ?? 'member'}`, m.role ?? 'member')}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function _suffix(webid) {
  if (typeof webid !== 'string') return '?';
  const i = webid.lastIndexOf('/');
  return i >= 0 ? webid.slice(i + 1) : webid;
}

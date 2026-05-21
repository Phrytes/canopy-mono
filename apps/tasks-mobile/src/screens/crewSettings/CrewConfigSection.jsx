/**
 * CrewConfigSection — admin-only read-only dump of getCrewConfig.
 *
 * Phase 41.18.2 (2026-05-10).
 *
 * Useful for support flows ("send me a screenshot of the crew config")
 * — same shape as Stoop's debug surface. Mirrors stoop-mobile's
 * "tap-to-reveal" pattern so the section stays collapsed by default
 * (debug surfaces shouldn't dominate the settings screen).
 */

import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';

import { useTheme } from '@canopy/react-native/theme';
import { useSkillResult } from '../../lib/useSkill.js';
import { useLocalisation }    from '../../LocalisationProvider.js';
import { useActiveRole } from '../../lib/useActiveRole.js';
import { useService } from '../../ServiceContext.js';

export function CrewConfigSection() {
  const svc = useService();
  const { isAdmin } = useActiveRole();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const [open, setOpen] = useState(false);

  const config = useSkillResult('getCrewConfig', {}, [svc?.activeCrewId, open]);

  if (!isAdmin) {
    return (
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
        {t('mobile.crew_settings.admin_only')}
      </Text>
    );
  }

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="crew-config-reveal"
      >
        <Text style={{ color: COLORS.primary, fontSize: FONT_SIZES.sm }}>
          {t('mobile.crew_settings.crew_config_reveal')}
        </Text>
      </Pressable>
    );
  }

  const data = config?.data ?? null;
  let pretty = '…';
  try {
    if (data) pretty = JSON.stringify(data, null, 2);
  } catch (err) {
    pretty = `(JSON.stringify failed: ${err?.message ?? err})`;
  }

  return (
    <View>
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: SPACING.sm,
      }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}>
          {t('mobile.crew_settings.crew_config_hint')}
        </Text>
        <Pressable onPress={() => setOpen(false)} accessibilityRole="button">
          <Text style={{ color: COLORS.primary, fontSize: FONT_SIZES.sm }}>
            {t('mobile.crew_settings.crew_config_hide')}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: RADII.sm,
          padding: SPACING.sm,
          maxHeight: 300,
        }}
      >
        <Text
          accessibilityLabel="crew-config-json"
          selectable
          style={{
            fontFamily: 'monospace',
            fontSize: 11,
            color: COLORS.text,
          }}
        >
          {pretty}
        </Text>
      </ScrollView>
    </View>
  );
}

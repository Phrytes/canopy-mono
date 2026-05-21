/**
 * AvailabilityAdminSection — V2.3 admin toggle for the per-crew
 * availability hints feature.
 *
 * Phase 41.8.7 (2026-05-09).
 *
 * Admin-only. Single switch wiring `setAvailabilityEnabled`. Members
 * see whether the feature is on (read-only) so they know the
 * AvailabilityScreen exists.
 */

import React, { useCallback } from 'react';
import { View, Text, Switch } from 'react-native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../../ServiceContext.js';
import { useSkill }    from '../../lib/useSkill.js';
import { useLocalisation }     from '../../LocalisationProvider.js';
import { useActiveRole } from '../../lib/useActiveRole.js';

export function AvailabilityAdminSection() {
  const svc = useService();
  const { isAdmin } = useActiveRole();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES } = useTheme();

  const cs = svc?.activeCrewId ? svc.crews.get(svc.activeCrewId) : null;
  const enabled = !!cs?.liveCrew?.availabilityHints?.enabled;

  const setEnabled = useSkill('setAvailabilityEnabled');

  const onToggle = useCallback(async (next) => {
    if (!isAdmin) return;
    await setEnabled.call({ enabled: !!next }).catch(() => {});
  }, [isAdmin, setEnabled]);

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <View style={{ flex: 1, marginRight: SPACING.md }}>
        <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
          {t('mobile.crew_settings.availability_admin_label')}
        </Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 }}>
          {t('mobile.crew_settings.availability_admin_hint')}
        </Text>
      </View>
      <Switch
        value={enabled}
        onValueChange={onToggle}
        disabled={!isAdmin}
        accessibilityLabel="availability-admin-toggle"
      />
    </View>
  );
}

/**
 * CalendarSyncSection — calendar emission per circle.
 *
 * Phase 41.8.6 (2026-05-09).
 *
 * Admin/coord toggle for the circle-wide setting, plus a per-member
 * URL display + status that members copy into their calendar app.
 */

import React, { useCallback } from 'react';
import { View, Text, Switch, Pressable } from 'react-native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../../ServiceContext.js';
import { useSkill, useSkillResult } from '../../lib/useSkill.js';
import { useLocalisation }    from '../../LocalisationProvider.js';
import { useActiveRole } from '../../lib/useActiveRole.js';

export function CalendarSyncSection() {
  const svc = useService();
  const { isAdminOrCoord, actor } = useActiveRole();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const cs = svc?.activeCircleId ? svc.circles.get(svc.activeCircleId) : null;
  const enabled = !!cs?.liveCircle?.calendarEmission?.enabled;

  const setEmission = useSkill('setCalendarEmission');
  const url   = useSkillResult('getCalendarEmissionUrl',    { memberWebid: actor }, [svc?.activeCircleId, actor]);
  const status = useSkillResult('getCalendarEmissionStatus', { memberWebid: actor }, [svc?.activeCircleId, actor]);

  const onToggle = useCallback(async (next) => {
    if (!isAdminOrCoord) return;
    await setEmission.call({ enabled: !!next }).catch(() => {});
  }, [isAdminOrCoord, setEmission]);

  const myUrl    = url?.data?.url ?? null;
  const myStatus = status?.data ?? {};

  return (
    <View>
      {isAdminOrCoord ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: SPACING.md,
        }}>
          <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
            {t('mobile.circle_settings.calendar_enable_label')}
          </Text>
          <Switch
            value={enabled}
            onValueChange={onToggle}
            accessibilityLabel="calendar-emission-enable-toggle"
          />
        </View>
      ) : null}

      {enabled && myUrl ? (
        <View style={{
          padding: SPACING.md,
          borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
          backgroundColor: COLORS.surface,
        }}>
          <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm, fontWeight: '500', marginBottom: SPACING.sm }}>
            {t('mobile.circle_settings.calendar_url_label')}
          </Text>
          <Text
            selectable
            style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontFamily: 'monospace' }}
          >
            {myUrl}
          </Text>
          {myStatus?.lastEmittedAt ? (
            <Text style={{ marginTop: SPACING.sm, color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}>
              {t('mobile.circle_settings.calendar_last_emitted', null)
                .replace('{when}', _formatTime(myStatus.lastEmittedAt))}
            </Text>
          ) : null}
          {Number.isFinite(myStatus?.eventCount) ? (
            <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}>
              {t('mobile.circle_settings.calendar_event_count', null)
                .replace('{count}', String(myStatus.eventCount))}
            </Text>
          ) : null}
        </View>
      ) : enabled ? (
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
          {t('mobile.circle_settings.calendar_url_pending')}
        </Text>
      ) : (
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
          {t('mobile.circle_settings.calendar_disabled')}
        </Text>
      )}
    </View>
  );
}

function _formatTime(epochMs) {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return '?';
  try {
    const d = new Date(epochMs);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '?';
  }
}

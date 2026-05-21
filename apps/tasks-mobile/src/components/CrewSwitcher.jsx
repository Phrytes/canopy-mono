/**
 * CrewSwitcher — header chip that shows the active crew + cycles
 * through the joined-crews list on tap.
 *
 * Phase 41.6.5 (2026-05-09).
 *
 * V1.0 ships a tap-to-cycle UX (simple) — Phase 41.7's CrewsDashboard
 * is the rich picker. This component is the lightweight indicator
 * we mount on Workspace + MyWork + Review headers so the user always
 * knows which crew they're acting in.
 */

import React, { useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useLocalisation }    from '../LocalisationProvider.js';

export function CrewSwitcher() {
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const onCycle = useCallback(() => {
    if (!svc) return;
    const ids = Array.from(svc.crews.keys());
    if (ids.length < 2) return;
    const cur = svc.activeCrewId;
    const idx = ids.indexOf(cur);
    const next = ids[(idx + 1) % ids.length];
    svc.setActiveCrew(next);
  }, [svc]);

  const activeId = svc?.activeCrewId;
  const active = activeId ? svc?.crews?.get(activeId) : null;
  const nameOrId = active?.liveCrew?.name ?? activeId ?? t('mobile.crew_switch.no_crews');
  const canCycle = (svc?.crews?.size ?? 0) >= 2;

  return (
    <Pressable
      onPress={canCycle ? onCycle : undefined}
      disabled={!canCycle}
      accessibilityRole="button"
      accessibilityLabel="crew-switcher"
      style={({ pressed }) => [
        {
          flexDirection: 'row', alignItems: 'center',
          paddingVertical:   SPACING.sm,
          paddingHorizontal: SPACING.md,
          borderRadius:      RADII.pill,
          backgroundColor:   COLORS.surface,
          borderWidth: 1, borderColor: COLORS.border,
        },
        pressed && canCycle && { opacity: 0.85 },
      ]}
    >
      <Text style={{ fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginRight: SPACING.sm }}>
        {t('mobile.crew_switch.label')}
      </Text>
      <Text
        numberOfLines={1}
        style={{ fontSize: FONT_SIZES.sm, color: COLORS.text, fontWeight: '600', maxWidth: 160 }}
      >
        {nameOrId}
      </Text>
      {canCycle ? (
        <Text style={{ marginLeft: SPACING.sm, color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}>
          ↻
        </Text>
      ) : null}
    </Pressable>
  );
}

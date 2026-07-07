/**
 * AvailabilityScreen — V2.3 7×2 (days × half-days) availability grid.
 *
 * Phase 41.9 (2026-05-09).
 *
 * Tap a cell → cycles state (unknown → open → tight → unavailable).
 * Each tap calls `setMyAvailability({week, day, half, state})` —
 * optimistic update locally first.
 *
 * Per-member opt-in toggle at the top: `setAvailabilityOptIn({optedIn})`.
 * When the circle has hints disabled (`liveCircle.availabilityHints.enabled
 * === false`), we render an off-state empty banner instead of the grid.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Switch } from 'react-native';

import { useTheme } from '@canopy/react-native/theme';
import { useService }     from '../ServiceContext.js';
import { useSkill, useSkillResult } from '../lib/useSkill.js';
import { useLocalisation }        from '../LocalisationProvider.js';
import {
  STATE_CYCLE, STATE_COLOR, STATE_LABEL_KEY,
  nextState, buildGrid, isoWeekOf, DAYS, HALVES,
} from '../lib/availabilityGrid.js';

export function AvailabilityScreen() {
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const week = useMemo(() => isoWeekOf(), []);
  const get = useSkillResult('getMyAvailability', { week }, [svc?.activeCircleId, week]);
  const setCell = useSkill('setMyAvailability');
  const setOptIn = useSkill('setAvailabilityOptIn');

  // Local optimistic state — keyed by `${day}.${half}`.
  const [local, setLocal] = useState({});

  useEffect(() => {
    setLocal({});
  }, [svc?.activeCircleId, week]);

  const remote = get?.data?.week ?? get?.data ?? {};
  const grid = useMemo(() => {
    const merged = { ...remote };
    for (const [k, v] of Object.entries(local)) {
      const [day, half] = k.split('.');
      merged[day] = { ...(merged[day] ?? {}), [half]: v };
    }
    return buildGrid(merged);
  }, [remote, local]);

  const optedIn = !!(get?.data?.optedIn);
  const circleEnabled =
    svc?.circles?.get(svc?.activeCircleId)?.liveCircle?.availabilityHints?.enabled ?? true;

  const onToggleCell = useCallback(async (day, half) => {
    const cur = local[`${day}.${half}`] ?? remote?.[day]?.[half] ?? 'unknown';
    const next = nextState(cur);
    setLocal((prev) => ({ ...prev, [`${day}.${half}`]: next }));
    try {
      await setCell.call({ week, day, half, state: next });
    } catch { /* keep local — refresh can reconcile */ }
  }, [local, remote, setCell, week]);

  const onToggleOptIn = useCallback(async (next) => {
    try { await setOptIn.call({ optedIn: !!next }); }
    finally { get.refresh().catch(() => {}); }
  }, [setOptIn, get]);

  if (!circleEnabled) {
    return (
      <View style={{ flex: 1, padding: SPACING.xl, backgroundColor: COLORS.background }}>
        <Text style={{ fontSize: FONT_SIZES.md, color: COLORS.textMuted }}>
          {t('mobile.availability.circle_disabled')}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md }}
    >
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: SPACING.md,
      }}>
        <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.text }}>
          {t('mobile.availability.opt_in_label')}
        </Text>
        <Switch value={optedIn} onValueChange={onToggleOptIn} accessibilityLabel="availability-opt-in" />
      </View>

      {!optedIn ? (
        <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.md }}>
          {t('mobile.availability.not_opted_in')}
        </Text>
      ) : null}

      <Text style={{ fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginBottom: SPACING.sm }}>
        {week}
      </Text>

      <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm, overflow: 'hidden' }}>
        <View style={{
          flexDirection: 'row',
          backgroundColor: COLORS.surfaceMuted,
        }}>
          <Cell text="" head colors={COLORS} fz={FONT_SIZES} sp={SPACING} />
          {HALVES.map((h) => (
            <Cell
              key={h}
              text={t(`mobile.availability.half_${h}`)}
              head
              colors={COLORS}
              fz={FONT_SIZES}
              sp={SPACING}
            />
          ))}
        </View>
        {grid.map((row) => (
          <View key={row.day} style={{ flexDirection: 'row' }}>
            <Cell
              text={t(`mobile.availability.day_${row.day}`)}
              head
              colors={COLORS}
              fz={FONT_SIZES}
              sp={SPACING}
            />
            {HALVES.map((h) => (
              <StateCell
                key={h}
                state={row[h]}
                onPress={() => optedIn && onToggleCell(row.day, h)}
                disabled={!optedIn}
                t={t}
                colors={COLORS}
                fz={FONT_SIZES}
                sp={SPACING}
              />
            ))}
          </View>
        ))}
      </View>

      <Text style={{
        marginTop: SPACING.md, fontSize: FONT_SIZES.xs, color: COLORS.textMuted,
      }}>
        {t('mobile.availability.tap_hint')}
      </Text>
    </ScrollView>
  );
}

function Cell({ text, head, colors, fz, sp }) {
  return (
    <View style={{
      flex: 1, padding: sp.sm, borderColor: colors.border,
      borderRightWidth: 1, borderBottomWidth: 1,
      backgroundColor: head ? colors.surfaceMuted : colors.surface,
      alignItems: 'center', justifyContent: 'center', minHeight: 36,
    }}>
      <Text style={{ color: colors.text, fontSize: fz.xs, fontWeight: head ? '600' : '400' }}>
        {text}
      </Text>
    </View>
  );
}

function StateCell({ state, onPress, disabled, t, colors, fz, sp }) {
  const colorKey = STATE_COLOR[state] ?? 'surfaceMuted';
  const bg = colors[colorKey] ?? colors.surfaceMuted;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`availability-cell-${state}`}
      style={({ pressed }) => [
        {
          flex: 1, padding: sp.sm,
          borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border,
          backgroundColor: bg,
          alignItems: 'center', justifyContent: 'center', minHeight: 36,
        },
        pressed && !disabled && { opacity: 0.85 },
      ]}
    >
      <Text style={{
        color: state === 'unknown' ? colors.textMuted : colors.textInverse,
        fontSize: fz.xs, fontWeight: '600',
      }}>
        {t(STATE_LABEL_KEY[state] ?? '', state)}
      </Text>
    </Pressable>
  );
}

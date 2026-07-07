/**
 * CirclesDashboardScreen — V2.5 cross-circle dashboard.
 *
 * Phase 41.7.1 (2026-05-09).
 *
 * Wires the V2.5 `getMyCircles` skill via useSkillResult. Each row
 * shows the circle's name + kind chip + four counters
 * (open / overdue / for-review / mine). Tap "Jump in" → flips
 * activeCircleId via svc.setActiveCircle + navigates Workspace.
 *
 * The list is busiest-first per the V2.5 aggregator's sort order.
 */

import React, { useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useService }     from '../ServiceContext.js';
import { useSkillResult } from '../lib/useSkill.js';
import { useLocalisation }        from '../LocalisationProvider.js';
import { ROUTES }         from '../navigation.js';

export function CirclesDashboardScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const list = useSkillResult('getMyCircles', {}, [svc?.activeCircleId]);
  const items = Array.isArray(list?.data?.circles) ? list.data.circles : [];

  const onJumpIn = useCallback((circleId) => {
    svc?.setActiveCircle?.(circleId);
    nav.navigate(ROUTES.Workspace);
  }, [svc, nav]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <FlatList
        contentContainerStyle={{ padding: SPACING.md, flexGrow: 1 }}
        data={items}
        keyExtractor={(c) => String(c.circleId)}
        refreshControl={
          <RefreshControl refreshing={!!list?.loading} onRefresh={() => list.refresh().catch(() => {})} />
        }
        ListEmptyComponent={
          <View style={{ padding: SPACING.xl, alignItems: 'center' }}>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.md, textAlign: 'center' }}>
              {t('mobile.circles.empty')}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <CircleRow circle={item} onJumpIn={() => onJumpIn(item.circleId)} />
        )}
      />

      {/* 41.18 follow-up — let users create another circle without
          having to leave-all-then-onboard. Routes to Welcome's
          create-modal via a flag the screen could honour, or
          most simply just sends them to Welcome which already
          owns the modal. */}
      <Pressable
        onPress={() => nav.navigate(ROUTES.Welcome, { openCreate: true })}
        accessibilityRole="button"
        accessibilityLabel="circles-new-circle"
        style={({ pressed }) => [
          {
            position: 'absolute',
            right: SPACING.lg, bottom: SPACING.lg,
            paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg,
            borderRadius: RADII.pill,
            backgroundColor: COLORS.primary,
            shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4,
            elevation: 4,
          },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' }}>
          {t('mobile.circles.new_circle', '+ New circle')}
        </Text>
      </Pressable>
    </View>
  );
}

function CircleRow({ circle, onJumpIn }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const { t } = useLocalisation();
  const counts = circle?.counts ?? {};
  return (
    <Pressable
      onPress={onJumpIn}
      accessibilityRole="button"
      accessibilityLabel={`circles-row-${circle.circleId}`}
      style={({ pressed }) => [
        {
          backgroundColor: COLORS.surface,
          borderColor:     COLORS.border,
          borderWidth:     1,
          borderRadius:    RADII.md,
          padding:         SPACING.md,
          marginBottom:    SPACING.sm,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm }}>
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            fontSize:   FONT_SIZES.md,
            fontWeight: '600',
            color:      COLORS.text,
          }}
        >
          {circle?.name ?? circle?.circleId}
        </Text>
        {circle?.kind ? (
          <View style={{
            paddingVertical: 2, paddingHorizontal: SPACING.sm,
            borderRadius: RADII.pill,
            backgroundColor: COLORS.surfaceMuted,
          }}>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}>
              {t(`mobile.circles.kind_${circle.kind}`, circle.kind)}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
        <Counter
          label={t('mobile.circles.counter_open',    null).replace('{count}', String(counts.open    ?? 0))}
          color={COLORS.text}
        />
        <Counter
          label={t('mobile.circles.counter_overdue', null).replace('{count}', String(counts.overdue ?? 0))}
          color={COLORS.danger}
          bold={(counts.overdue ?? 0) > 0}
        />
        <Counter
          label={t('mobile.circles.counter_review',  null).replace('{count}', String(counts.awaitingApproval ?? 0))}
          color={COLORS.warning}
          bold={(counts.awaitingApproval ?? 0) > 0}
        />
        <Counter
          label={t('mobile.circles.counter_mine',    null).replace('{count}', String(counts.mine    ?? 0))}
          color={COLORS.info}
        />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACING.md }}>
        <Text style={{ color: COLORS.primary, fontSize: FONT_SIZES.sm, fontWeight: '600' }}>
          {t('mobile.circles.jump_in')} →
        </Text>
      </View>
    </Pressable>
  );
}

function Counter({ label, color, bold }) {
  const { FONT_SIZES } = useTheme();
  return (
    <Text style={{
      fontSize:   FONT_SIZES.xs,
      color,
      fontWeight: bold ? '600' : '400',
    }}>
      {label}
    </Text>
  );
}

/**
 * Pure-fn helper exported for tests + a future bottom-tab badge.
 * Sums the four counters into a single "busy" number.
 */
export function busyTotal(counts) {
  if (!counts || typeof counts !== 'object') return 0;
  return (counts.open ?? 0) + (counts.overdue ?? 0)
       + (counts.awaitingApproval ?? 0) + (counts.mine ?? 0);
}

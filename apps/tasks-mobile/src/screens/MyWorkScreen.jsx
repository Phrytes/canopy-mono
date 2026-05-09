/**
 * MyWorkScreen — three-section list: Assigned to me / I'm reviewing /
 * Open for grabs.
 *
 * Phase 41.5.1 (2026-05-09).
 *
 * Wires `listMine`, `listMyMasteredTasks`, `listClaimable` via
 * `useSkillResult`. Reuses <TaskCard> for rendering. <PlannerCards>
 * sits at the top — V2.4 schedule suggestions for the calling actor's
 * open assignments.
 *
 * V2.7-aware via TaskCard's status-driven UI: deps-blocked items
 * show the open-deps count chip; the disabled-close behaviour lives
 * in TaskDetailScreen (tap a card to act).
 */

import React, { useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useService }     from '../ServiceContext.js';
import { useSkillResult } from '../lib/useSkill.js';
import { useI18n }        from '../I18nProvider.js';
import { TaskCard }       from '../components/TaskCard.jsx';
import { PlannerCards }   from '../components/PlannerCards.jsx';
import { ROUTES }         from '../navigation.js';

export function MyWorkScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES } = useTheme();

  const mine      = useSkillResult('listMine',              {}, [svc?.activeCrewId]);
  const mastered  = useSkillResult('listMyMasteredTasks',   {}, [svc?.activeCrewId]);
  const claimable = useSkillResult('listClaimable',         {}, [svc?.activeCrewId]);

  const onPressTask = useCallback((id) => {
    nav.navigate(ROUTES.TaskDetail, { id });
  }, [nav]);

  const refreshAll = useCallback(() => {
    mine.refresh().catch(() => {});
    mastered.refresh().catch(() => {});
    claimable.refresh().catch(() => {});
  }, [mine, mastered, claimable]);

  const refreshing =
    !!mine?.loading || !!mastered?.loading || !!claimable?.loading;

  const sections = [
    {
      key:   'assigned',
      title: t('mobile.my_work.section_assigned'),
      empty: t('mobile.my_work.empty_assigned'),
      items: _itemsOf(mine?.data),
    },
    {
      key:   'mastered',
      title: t('mobile.my_work.section_mastered'),
      empty: t('mobile.my_work.empty_mastered'),
      items: _itemsOf(mastered?.data),
    },
    {
      key:   'claimable',
      title: t('mobile.my_work.section_claimable'),
      empty: t('mobile.my_work.empty_claimable'),
      items: _itemsOf(claimable?.data),
    },
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
    >
      <PlannerCards />

      {sections.map((section) => (
        <View key={section.key} style={{ marginBottom: SPACING.lg }}>
          <Text style={{
            fontSize:    FONT_SIZES.md,
            fontWeight:  '600',
            color:       COLORS.text,
            marginBottom: SPACING.sm,
          }}>
            {section.title}
          </Text>

          {section.items.length === 0 ? (
            <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.md }}>
              {section.empty}
            </Text>
          ) : (
            section.items.map((item) => (
              <TaskCard key={item.id} task={item} onPress={onPressTask} />
            ))
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function _itemsOf(data) {
  if (!data) return [];
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.tasks)) return data.tasks;
  return [];
}

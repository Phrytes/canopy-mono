/**
 * MyWorkScreen — three-section list: Assigned to me / I'm reviewing /
 * Open for grabs.
 *
 * Phase 41.5.1 (2026-05-09).
 *
 * Slice C.2 (2026-05-20) — adapter-driven.  Each of the three
 * sections now resolves its skill via the V0.2 NavModel's
 * `dataSource` (Q7) through `createNavModelAdapter(tasksManifest)`:
 *
 *   - `mine`      → `listMine`
 *   - `mastered`  → `listMyMasteredTasks`
 *   - `claimable` → `listClaimable`
 *
 * Skill ids + args are no longer hand-coded — they come from
 * `adapter.getSection(id).dataSource`, with `useSkillResult` keeping
 * the mount/refresh/dep-tracking lifecycle (same pattern as
 * WorkspaceScreen's Slice C.1 migration).
 *
 * What stays hand-built:
 *   - <PlannerCards> header — V2.4 schedule suggestions, an RN-
 *     specific mobile UI element not modelled in NavModel.
 *   - Tap → TaskDetail navigation + pull-to-refresh — RN screen
 *     lifecycle concerns the adapter intentionally doesn't model.
 *
 * V2.7-aware via TaskCard's status-driven UI: deps-blocked items
 * show the open-deps count chip; the disabled-close behaviour lives
 * in TaskDetailScreen (tap a card to act).
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { tasksManifest } from '@canopy-app/tasks-v0/manifest';

import { useTheme } from '@canopy/react-native/theme';
import { useService }     from '../ServiceContext.js';
import { toParts, unwrapParts } from '../lib/useSkill.js';
import { useI18n }        from '../I18nProvider.js';
import { TaskCard }       from '../components/TaskCard.jsx';
import { PlannerCards }   from '../components/PlannerCards.jsx';
import { ROUTES }         from '../navigation.js';
import { createNavModelAdapter } from '../manifest-adapter.js';
import { useAdapterSection }     from '../useAdapterSection.js';

export function MyWorkScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES } = useTheme();

  // Slice C.2 — build the NavModel adapter once per service-change,
  // same shape as WorkspaceScreen's Slice C.1 wiring.  The adapter is
  // platform-neutral; `callSkill` mirrors the imperative dispatcher
  // useSkill's `.call` takes internally.  Used here to resolve the
  // dataSource for each section; the screen still uses useSkillResult
  // to keep mount/refresh/dep-tracking lifecycle ownership.
  const adapter = useMemo(
    () => createNavModelAdapter(tasksManifest, {
      callSkill: async (skillId, args) => {
        const agent = svc?.activeBundle?.agent;
        if (!agent?.invoke) throw new Error('No active agent');
        const peer  = agent.address ?? agent.identity?.pubKey ?? null;
        const parts = toParts({
          ...(args ?? {}),
          _scope: svc?.activeBundle?.groupId ?? svc?.activeGroupId ?? null,
        });
        return unwrapParts(await agent.invoke(peer, skillId, parts));
      },
    }),
    [svc],
  );

  // V0.3-adopt (2026-05-21) — `useAdapterSection` collapses the
  // per-section boilerplate (3 sections × 4 lines = 12 lines saved).
  // Same data shape; same lifecycle.  Skill ids + args come from the
  // manifest's Q7 dataSource declarations on the mine/mastered/
  // claimable views.
  const mine      = useAdapterSection(adapter, 'mine',      [svc?.activeCrewId]);
  const mastered  = useAdapterSection(adapter, 'mastered',  [svc?.activeCrewId]);
  const claimable = useAdapterSection(adapter, 'claimable', [svc?.activeCrewId]);

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

  // Phase 41.18 follow-up — when all three sections are empty,
  // collapse to a single "all clear" message instead of three
  // stacked empties. Less noise on a fresh crew.
  const allEmpty = sections.every((s) => s.items.length === 0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.md, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
    >
      <PlannerCards />

      {allEmpty ? (
        <View style={{
          paddingVertical: SPACING.xl, alignItems: 'center',
          flex: 1, justifyContent: 'center',
        }}>
          <Text style={{
            fontSize: FONT_SIZES.lg, fontWeight: '600',
            color: COLORS.text, marginBottom: SPACING.sm,
          }}>
            {t('mobile.my_work.all_clear_title')}
          </Text>
          <Text style={{
            fontSize: FONT_SIZES.sm, color: COLORS.textMuted,
            textAlign: 'center', maxWidth: 320,
          }}>
            {t('mobile.my_work.all_clear_body')}
          </Text>
        </View>
      ) : (
        sections.map((section) => (
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
        ))
      )}
    </ScrollView>
  );
}

function _itemsOf(data) {
  if (!data) return [];
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.tasks)) return data.tasks;
  return [];
}

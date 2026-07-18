/**
 * WorkspaceScreen — list of open tasks for the active circle, with
 * filter chips + FAB to compose.
 *
 * Phase 41.4.1 (2026-05-09).
 *
 * Slice C.1 (2026-05-20) — adapter-driven.  The screen now resolves
 * its data source through `createNavModelAdapter(tasksManifest)` —
 * the NavModel's `open` section carries `dataSource: {skillId:
 * 'listOpen', args: {type: 'task'}}` (manifest Q7).  The screen
 * keeps its hand-built UI (RN filter chips, FlatList, FAB) and the
 * existing `useSkillResult` reactive plumbing; only the skill-id +
 * args come from the manifest.  This proves the adapter pattern on
 * one screen; the remaining Phase-1 screens follow in Slice C.2+.
 *
 * Why keep `useSkillResult` instead of going imperative via the
 * adapter's `fetchSection`?  The hook owns the
 * mount/refresh/dep-tracking lifecycle that pull-to-refresh + circle-
 * switch already work against.  Adapter-driven dispatch via the
 * imperative path is a separate slice (web today uses imperative
 * `callSkill` because it has no React lifecycle).
 *
 * Filter chips (ready/waiting/claimed/submitted) stay hand-built —
 * they're RN-specific UI chrome not modelled in V0.2 NavModel.
 * Tap a card → TaskDetail.  FAB → ComposeScreen modal.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { tasksManifest } from '@canopy-app/tasks/manifest';

import { useTheme } from '@canopy/react-native/theme';
import { ChipRow }  from '@canopy/react-native/components';

import { useService }     from '../ServiceContext.js';
import { toParts, unwrapParts } from '../lib/useSkill.js';
import { useLocalisation }        from '../LocalisationProvider.js';
import { TaskCard }       from '../components/TaskCard.jsx';
import { ROUTES }         from '../navigation.js';
import { createNavModelAdapter } from '../manifest-adapter.js';
import { useAdapterSection }     from '../useAdapterSection.js';

const FILTER_CHIPS = [
  { id: 'all',       labelKey: 'mobile.workspace.filter_all' },
  { id: 'ready',     labelKey: 'mobile.workspace.filter_ready' },
  { id: 'waiting',   labelKey: 'mobile.workspace.filter_waiting' },
  { id: 'claimed',   labelKey: 'mobile.workspace.filter_claimed' },
  { id: 'submitted', labelKey: 'mobile.workspace.filter_submitted' },
];

export function WorkspaceScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const [filter, setFilter] = useState('all');

  // Slice C.1 — build the NavModel adapter once per service-change.
  // The adapter is platform-neutral; `callSkill` is a tiny imperative
  // dispatcher over the active bundle's agent.invoke (the same path
  // useSkill's `.call` takes internally).  Used by `fetchSection` +
  // `renderItemActions` consumers; the screen itself still uses
  // useSkillResult to fetch the list (lifecycle ownership).
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
  // V0.3-adopt (2026-05-21) — `useAdapterSection` replaces the
  // per-section boilerplate (getSection + skillId resolution + args
  // resolution + useSkillResult).  Same data + lifecycle; cleaner
  // call site.
  const { section, data, loading, refresh } =
    useAdapterSection(adapter, 'open', [svc?.activeCircleId, filter]);
  const list = { data, loading, refresh };  // shape compatibility

  const items = useMemo(() => {
    const all = Array.isArray(list?.data?.items) ? list.data.items : [];
    if (filter === 'all') return all;
    return all.filter((it) => it?.status === filter);
  }, [list?.data, filter]);

  const onPressTask = useCallback((id) => {
    nav.navigate(ROUTES.TaskDetail, { id });
  }, [nav]);

  const onRefresh = useCallback(() => {
    list.refresh().catch(() => {});
  }, [list]);

  const filterItems = useMemo(
    () => FILTER_CHIPS.map((c) => ({ id: c.id, label: t(c.labelKey) })),
    [t],
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ChipRow
        items={filterItems}
        selected={[filter]}
        onToggle={(id) => setFilter(id)}
        singleSelect
      />

      <FlatList
        contentContainerStyle={{ padding: SPACING.md, flexGrow: 1 }}
        data={items}
        keyExtractor={(it) => String(it.id)}
        renderItem={({ item }) => (
          <TaskCard task={item} onPress={onPressTask} />
        )}
        refreshControl={
          <RefreshControl refreshing={!!list?.loading} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={{
            padding: SPACING.xl, alignItems: 'center',
            flexGrow: 1, justifyContent: 'center',
          }}>
            <Text style={{
              color: COLORS.text, fontSize: FONT_SIZES.lg, fontWeight: '600',
              marginBottom: SPACING.sm, textAlign: 'center',
            }}>
              {t('mobile.workspace.empty_title')}
            </Text>
            <Text style={{
              color: COLORS.textMuted, fontSize: FONT_SIZES.sm,
              textAlign: 'center', marginBottom: SPACING.lg, maxWidth: 320,
            }}>
              {t('mobile.workspace.empty')}
            </Text>
            <Pressable
              onPress={() => nav.navigate(ROUTES.Compose)}
              accessibilityRole="button"
              accessibilityLabel="workspace-empty-add"
              style={({ pressed }) => [
                {
                  paddingVertical: SPACING.md, paddingHorizontal: SPACING.xl,
                  borderRadius: RADII.pill,
                  backgroundColor: COLORS.primary,
                },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={{
                color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600',
              }}>
                {t('mobile.workspace.empty_add')}
              </Text>
            </Pressable>
          </View>
        }
      />

      <Pressable
        onPress={() => nav.navigate(ROUTES.Compose)}
        accessibilityRole="button"
        accessibilityLabel="workspace-fab-add"
        style={({ pressed }) => [
          {
            position: 'absolute',
            right: SPACING.lg,
            bottom: SPACING.lg,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: COLORS.primary,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
          },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={{
          color: COLORS.textInverse,
          fontSize: FONT_SIZES.xxl,
          fontWeight: '300',
        }}>
          {t('mobile.workspace.fab_add')}
        </Text>
      </Pressable>
    </View>
  );
}

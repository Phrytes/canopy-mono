/**
 * WorkspaceScreen — list of open tasks for the active crew, with
 * filter chips + FAB to compose.
 *
 * Phase 41.4.1 (2026-05-09).
 *
 * Wires `listOpen` via `useSkillResult` (lifted in Phase 41.0 L1) and
 * pull-to-refresh. Filter chips live above the list — toggling re-runs
 * the skill with the matching args. Tap a card → TaskDetail. FAB →
 * ComposeScreen modal.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { ChipRow }  from '@canopy/react-native/components';

import { useService }     from '../ServiceContext.js';
import { useSkillResult } from '../lib/useSkill.js';
import { useI18n }        from '../I18nProvider.js';
import { TaskCard }       from '../components/TaskCard.jsx';
import { ROUTES }         from '../navigation.js';

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
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const [filter, setFilter] = useState('all');

  // useSkillResult auto-runs on mount + when deps change. We re-run
  // when the active crew changes so a crew-switch refreshes the list.
  const list = useSkillResult('listOpen', {}, [svc?.activeCrewId, filter]);

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

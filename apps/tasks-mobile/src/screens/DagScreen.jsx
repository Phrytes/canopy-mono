/**
 * DagScreen — sub-task tree view.
 *
 * Phase 41.6.3 (2026-05-09).
 *
 * Wires `getDagTree` via useSkillResult. Renders a flat indented
 * list (one row per node) with a status pill per node. Tap → TaskDetail.
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { useTheme }       from '@canopy/react-native/theme';
import { useService }     from '../ServiceContext.js';
import { useSkillResult } from '../lib/useSkill.js';
import { useLocalisation }        from '../LocalisationProvider.js';
import { describeTaskStatus } from '../lib/taskStatus.js';
import { flattenDagTree } from '../lib/dagFlatten.js';
import { ROUTES }         from '../navigation.js';

export function DagScreen() {
  const nav   = useNavigation();
  const route = useRoute();
  const svc   = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  // Accept either `rootId` (preferred) or `id` (legacy nav callers
  // that haven't migrated). The skill expects `rootId`; passing the
  // wrong field name made the screen fall through to the all-roots
  // branch — see Phase 41.18 follow-up.
  const rootId = route?.params?.rootId ?? route?.params?.id ?? null;
  const tree = useSkillResult(
    'getDagTree',
    rootId ? { rootId } : {},
    [svc?.activeCircleId, rootId],
  );

  const rows = useMemo(() => flattenDagTree(tree?.data), [tree?.data]);

  const onRefresh = useCallback(() => { tree.refresh().catch(() => {}); }, [tree]);

  return (
    <FlatList
      data={rows}
      keyExtractor={(r, idx) => `${r.task?.id}-${idx}`}
      contentContainerStyle={{ padding: SPACING.md, flexGrow: 1 }}
      style={{ backgroundColor: COLORS.background }}
      refreshControl={<RefreshControl refreshing={!!tree?.loading} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <View style={{ padding: SPACING.xl, alignItems: 'center' }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.md, textAlign: 'center' }}>
            {t('mobile.dag.empty')}
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const status = describeTaskStatus(item.task);
        const pillBg = COLORS[status.colorKey] ?? COLORS.textMuted;
        return (
          <Pressable
            onPress={() => nav.navigate(ROUTES.TaskDetail, { id: item.task?.id })}
            accessibilityRole="button"
            accessibilityLabel={`dag-row-${item.task?.id}`}
            style={({ pressed }) => [
              {
                paddingVertical: SPACING.sm,
                paddingLeft: SPACING.md + (item.depth * SPACING.lg),
                paddingRight: SPACING.md,
                borderRadius: RADII.sm,
                backgroundColor: COLORS.surface,
                borderWidth: 1,
                borderColor: COLORS.border,
                marginBottom: 4,
                flexDirection: 'row',
                alignItems: 'center',
              },
              pressed && { opacity: 0.85 },
            ]}
          >
            {item.depth > 0 ? (
              <Text style={{ color: COLORS.textMuted, marginRight: 4 }}>
                {t('mobile.dag.indent')}
              </Text>
            ) : null}
            <View style={{
              backgroundColor: pillBg,
              borderRadius: RADII.pill,
              paddingVertical: 2, paddingHorizontal: SPACING.sm,
              marginRight: SPACING.sm,
            }}>
              <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.xs, fontWeight: '600' }}>
                {t(`mobile.workspace.status_${status.kind}`, status.label)}
              </Text>
            </View>
            <Text
              numberOfLines={1}
              style={{ flex: 1, color: COLORS.text, fontSize: FONT_SIZES.sm }}
            >
              {item.task?.text ?? '—'}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

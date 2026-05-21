/**
 * ReviewScreen — the master/coord-reviewer queue.
 *
 * Phase 41.6.1 (2026-05-09).
 *
 * Slice C.3 (2026-05-20) — adapter-driven (third RN screen).
 *
 * Builds on C.1 (Workspace) + C.2 (MyWork): the screen now resolves
 * both its data source AND its per-row action set through the
 * NavModel adapter:
 *
 *   - **Data source** (V0.2 Q7 `dataSource` + V0.3 `useAdapterSection`):
 *     the `review` view's `dataSource` declares `listAwaitingApproval`
 *     in the manifest (B.2.2); pre-C.3 the screen called the skill id
 *     directly via `useSkillResult('listAwaitingApproval')`. The hook
 *     now resolves the id + args through `adapter.getSection('review')`.
 *
 *   - **Per-row actions** (V0.4 `itemActions[]` + the V0.7 DoD-
 *     lifecycle state gate): `adapter.renderItemActions(section, item)`
 *     filters the section's manifest-projected `itemActions[]` by
 *     `appliesTo.state` (only `approveTask` / `rejectTask` / `revokeTask`
 *     surface on `submitted` items). Pre-C.3 the screen hard-coded
 *     "show approve + reject" with no state gate; C.3 inherits the
 *     same multi-state lifecycle gate the web review page already has
 *     (sliceB2_2-review.test.js). This is the first RN screen to
 *     consume `renderItemActions` — exercising the adapter's full V0.4
 *     surface end-to-end.
 *
 * What stays hand-built:
 *   - **Button styling + labels** — localisation via `t('mobile.review.*')`;
 *     RN Pressable + theme tokens (the adapter's `action.label` is the
 *     manifest's English string, not localisation).
 *   - **V2.7 deps gate on Approve** — `describeTaskStatus(item).canClose`
 *     gates the Approve button's `disabled` state (RN-specific UX hint;
 *     the manifest's `appliesTo.state` gate decides VISIBILITY, the
 *     V2.7 deps gate decides ENABLED-ness). When `canClose` is false
 *     the button still surfaces but disabled with the "open task to
 *     use Force-complete" hint.
 *   - **Reject flow** — pushes to TaskDetailScreen so the user can
 *     enter the mandatory `note` param (`rejectTask` requires it;
 *     ComposeScreen-style modal for a single text field is overkill
 *     when the detail screen already does this).
 *   - **Per-photo thumbnail** + DeliverablePhoto rendering — RN-only
 *     UI chrome.
 *
 * Skill dispatch:
 *   The screen keeps its `useSkill('approveTask')` / `useSkill('rejectTask')`
 *   bindings — those hooks own the activeCrewId-injection + reply
 *   parts-unwrapping path. The adapter only DECLARES which actions
 *   may surface on each item; the bound hooks DISPATCH. (Same split as
 *   C.1's `useAdapterSection` for data: adapter declares, hook
 *   dispatches.)
 *
 * V2.7-aware: when `item.status === 'waiting'` the Approve button is
 * disabled with the "Has open dependencies" hint — the user has to
 * open TaskDetail to use Force-complete (admin-only).
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { tasksManifest } from '@canopy-app/tasks-v0/manifest';

import { useTheme }       from '@canopy/react-native/theme';
import { useService }     from '../ServiceContext.js';
import { useSkill, toParts, unwrapParts } from '../lib/useSkill.js';
import { useLocalisation }        from '../LocalisationProvider.js';
import { describeTaskStatus } from '../lib/taskStatus.js';
import { DeliverablePhoto } from '../components/DeliverablePhoto.jsx';
import { ROUTES }          from '../navigation.js';
import { createNavModelAdapter } from '../manifest-adapter.js';
import { useAdapterSection }     from '../useAdapterSection.js';

export function ReviewScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  // Slice C.3 — build the NavModel adapter once per service-change.
  // Same shape as WorkspaceScreen (C.1) + MyWorkScreen (C.2). The
  // adapter is platform-neutral; `callSkill` is a tiny imperative
  // dispatcher used by `fetchSection` consumers (here unused — the
  // screen's lifecycle dispatcher is `useSkillResult` via
  // `useAdapterSection`; `renderItemActions` is sync + needs no
  // dispatcher).
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

  // Data source resolved via the manifest's `review` view dataSource
  // (V0.2 Q7 — `listAwaitingApproval`). Same `useAdapterSection`
  // pattern as Workspace + MyWork.
  const { section, data, loading, refresh } =
    useAdapterSection(adapter, 'review', [svc?.activeCrewId]);
  const list = { data, loading, refresh };

  const approve = useSkill('approveTask');
  const reject  = useSkill('rejectTask');

  const items = Array.isArray(list?.data?.items) ? list.data.items : [];

  const onRefresh = useCallback(() => { list.refresh().catch(() => {}); }, [list]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <FlatList
        data={items}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={{ padding: SPACING.md, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={!!list?.loading} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={{ padding: SPACING.xl, alignItems: 'center' }}>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.md, textAlign: 'center' }}>
              {t('mobile.review.empty')}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <ReviewRow
            item={item}
            // Slice C.3 — itemActions[] for this row, state-gated by
            // the manifest's V0.7 DoD-lifecycle `appliesTo.state`.
            // For submitted items: [approveTask, rejectTask, revokeTask].
            // For non-submitted (defensive — the list-skill should only
            // return submitted items, but the adapter's gate is the
            // truth-source): empty / different set.
            actions={section ? adapter.renderItemActions(section, item) : []}
            onOpen={() => nav.navigate(ROUTES.TaskDetail, { id: item.id })}
            onApprove={async () => {
              const r = await approve.call({ id: item.id });
              if (r?.error) Alert.alert(String(r.error));
              list.refresh().catch(() => {});
            }}
            // Reject requires a mandatory `note` param — defer to
            // TaskDetailScreen for the input UI rather than inlining a
            // text-only modal here. The hand-off keeps the manifest's
            // `rejectTask` schema (`note: required`) honoured.
            onReject={() => nav.navigate(ROUTES.TaskDetail, { id: item.id })}
          />
        )}
      />
    </View>
  );
}

function ReviewRow({ item, actions, onOpen, onApprove, onReject }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const { t } = useLocalisation();
  const status = describeTaskStatus(item);
  const blocked = !status.canClose; // V2.7 — waiting/blocked means Approve is gated

  // Slice C.3 — derive button visibility from the manifest's
  // state-gated itemActions[] (V0.4). The action LIST decides which
  // buttons surface; localisation + RN styling are local. This matches the
  // web review.html pattern (sliceB2_2-review.test.js) where the page
  // walks `section.itemActions` and renders only matching ops.
  const actionIds = new Set((actions ?? []).map((a) => a.opId));
  const canApprove = actionIds.has('approveTask');
  const canReject  = actionIds.has('rejectTask');

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`review-card-${item.id}`}
      style={({ pressed }) => [
        {
          backgroundColor: COLORS.surface,
          borderRadius: RADII.md,
          padding: SPACING.md,
          marginBottom: SPACING.sm,
          borderWidth: 1, borderColor: COLORS.border,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={{ flexDirection: 'row' }}>
        {item?.deliverable?.kind === 'photo' ? (
          <View style={{ marginRight: SPACING.md }}>
            <DeliverablePhoto deliverable={item.deliverable} thumbSize={80} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={2}
            style={{ fontSize: FONT_SIZES.md, color: COLORS.text, fontWeight: '500' }}
          >
            {item?.text ?? ''}
          </Text>
          {item?.deliverable?.note ? (
            <Text
              numberOfLines={2}
              style={{ marginTop: 4, fontSize: FONT_SIZES.sm, color: COLORS.textMuted }}
            >
              "{item.deliverable.note}"
            </Text>
          ) : null}
        </View>
      </View>

      {blocked && canApprove ? (
        <Text style={{ marginTop: SPACING.sm, color: COLORS.warning, fontSize: FONT_SIZES.xs }}>
          {t('mobile.review.blocked_hint')}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', marginTop: SPACING.sm }}>
        {canApprove ? (
          <Pressable
            onPress={onApprove}
            disabled={blocked}
            accessibilityRole="button"
            accessibilityLabel={`review-approve-${item.id}`}
            style={{
              paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
              borderRadius: RADII.pill, marginRight: SPACING.sm,
              backgroundColor: blocked ? COLORS.surfaceMuted : COLORS.primary,
            }}
          >
            <Text style={{
              color: blocked ? COLORS.textMuted : COLORS.textInverse,
              fontSize: FONT_SIZES.sm, fontWeight: '600',
            }}>
              {t('mobile.review.approve')}
            </Text>
          </Pressable>
        ) : null}
        {canReject ? (
          <Pressable
            onPress={onReject}
            accessibilityRole="button"
            accessibilityLabel={`review-reject-${item.id}`}
            style={{
              paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
              borderRadius: RADII.pill, borderWidth: 1, borderColor: COLORS.border,
              backgroundColor: COLORS.surface,
            }}
          >
            <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
              {t('mobile.review.reject')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * ReviewScreen — the master/coord-reviewer queue.
 *
 * Phase 41.6.1 (2026-05-09).
 *
 * Wires `listAwaitingApproval` via useSkillResult. Each row shows
 * the task summary + an inline DeliverablePhoto thumbnail (Phase
 * 41.6.2) when the deliverable is a photo, with quick Approve /
 * Reject buttons.
 *
 * V2.7-aware: when `item.status === 'waiting'` the Approve button
 * is disabled with the "Has open dependencies" hint — the user has
 * to open TaskDetail to use Force-complete (admin-only).
 */

import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme }       from '@canopy/react-native/theme';
import { useService }     from '../ServiceContext.js';
import { useSkill, useSkillResult } from '../lib/useSkill.js';
import { useI18n }        from '../I18nProvider.js';
import { describeTaskStatus } from '../lib/taskStatus.js';
import { DeliverablePhoto } from '../components/DeliverablePhoto.jsx';
import { ROUTES }          from '../navigation.js';

export function ReviewScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const list = useSkillResult('listAwaitingApproval', {}, [svc?.activeCrewId]);
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
            onOpen={() => nav.navigate(ROUTES.TaskDetail, { id: item.id })}
            onApprove={async () => {
              const r = await approve.call({ id: item.id });
              if (r?.error) Alert.alert(String(r.error));
              list.refresh().catch(() => {});
            }}
            onReject={() => nav.navigate(ROUTES.TaskDetail, { id: item.id })}
          />
        )}
      />
    </View>
  );
}

function ReviewRow({ item, onOpen, onApprove, onReject }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const { t } = useI18n();
  const status = describeTaskStatus(item);
  const blocked = !status.canClose; // V2.7 — waiting/blocked means Approve is gated

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

      {blocked ? (
        <Text style={{ marginTop: SPACING.sm, color: COLORS.warning, fontSize: FONT_SIZES.xs }}>
          {t('mobile.review.blocked_hint')}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', marginTop: SPACING.sm }}>
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
      </View>
    </Pressable>
  );
}

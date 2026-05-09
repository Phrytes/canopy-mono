/**
 * TaskCard — one row in the WorkspaceScreen + MyWorkScreen lists.
 *
 * Phase 41.4.3 (2026-05-09).
 *
 * Renders:
 *   - status pill (color per V2.7 status)
 *   - deps-blocked count chip when status === 'waiting'
 *   - assignee chip when claimed/submitted/complete
 *   - required-skill chip
 *   - dueAt (when set)
 *
 * Tap → TaskDetail. Pure-controlled — caller passes `task` + `onPress`.
 */

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from '@canopy/react-native/theme';
import { describeTaskStatus } from '../lib/taskStatus.js';
import { useI18n } from '../I18nProvider.js';

/**
 * @param {object} props
 * @param {object} props.task                 listOpen item
 * @param {(taskId: string) => void} props.onPress
 * @param {(webid: string) => string} [props.resolveDisplayName]
 *   Optional formatter for assignee — defaults to the webid suffix.
 */
export function TaskCard({ task, onPress, resolveDisplayName }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const { t } = useI18n();
  const status = describeTaskStatus(task);

  const pillBg = COLORS[status.colorKey] ?? COLORS.textMuted;
  const dueAt  = _formatDate(task?.dueAt);
  const skill  = task?.requiredSkill;
  const assigneeLabel = task?.assignee
    ? (resolveDisplayName?.(task.assignee) ?? _suffix(task.assignee))
    : null;

  return (
    <Pressable
      onPress={() => onPress?.(task?.id)}
      accessibilityRole="button"
      accessibilityLabel={`task-card-${task?.id}`}
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
        <View style={{
          backgroundColor: pillBg,
          borderRadius:    RADII.pill,
          paddingVertical:   2,
          paddingHorizontal: SPACING.sm,
          marginRight:     SPACING.sm,
        }}>
          <Text style={{
            color: COLORS.textInverse,
            fontSize: FONT_SIZES.xs,
            fontWeight: '600',
          }}>
            {t(`mobile.workspace.status_${status.kind}`, status.label)}
          </Text>
        </View>

        {status.kind === 'waiting' && status.openDepIds.length > 0 ? (
          <View style={{
            backgroundColor: COLORS.surfaceMuted,
            borderRadius:    RADII.pill,
            paddingVertical:   2,
            paddingHorizontal: SPACING.sm,
          }}>
            <Text style={{
              color: COLORS.textMuted,
              fontSize: FONT_SIZES.xs,
            }}>
              {t('mobile.workspace.deps_count', null)
                .replace('{count}', String(status.openDepIds.length))}
            </Text>
          </View>
        ) : null}
      </View>

      <Text
        numberOfLines={2}
        style={{
          fontSize:   FONT_SIZES.md,
          color:      COLORS.text,
          fontWeight: '500',
          marginBottom: SPACING.sm,
        }}
      >
        {task?.text ?? ''}
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
        {assigneeLabel ? (
          <Text style={{ fontSize: FONT_SIZES.xs, color: COLORS.textMuted }}>
            {t('mobile.workspace.assignee_label', null).replace('{name}', assigneeLabel)}
          </Text>
        ) : null}
        {skill ? (
          <Text style={{ fontSize: FONT_SIZES.xs, color: COLORS.textMuted }}>
            #{skill}
          </Text>
        ) : null}
        {dueAt ? (
          <Text style={{ fontSize: FONT_SIZES.xs, color: COLORS.textMuted }}>
            {t('mobile.workspace.due_label', null).replace('{date}', dueAt)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function _suffix(webid) {
  if (typeof webid !== 'string') return '?';
  const i = webid.lastIndexOf('/');
  return i >= 0 ? webid.slice(i + 1) : webid;
}

function _formatDate(epochMs) {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return null;
  try {
    const d = new Date(epochMs);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

export const _internal = { _suffix, _formatDate };

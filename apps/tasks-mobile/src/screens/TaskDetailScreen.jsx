/**
 * TaskDetailScreen — full-screen detail view.
 *
 * Phase 41.4.2 (2026-05-09).
 *
 * Renders title, status pill, deliverable summary, reviewLog history
 * + the per-state actions:
 *   - ready  → "Claim" (any member)
 *   - claimed → "Submit" / "Mark complete" (assignee, depending on DoD)
 *   - submitted → "Approve" / "Reject" (creator/admin/coord per V1 DoD)
 *   - waiting → V2.7 disabled "Mark complete" + tooltip + admin
 *               "Force complete" CTA (Phase 41.4.4 + 41.4.5)
 *   - "Add sub-task" → V2.7-aware: when parent is submitted and the
 *               caller isn't the assignee, the label flips to
 *               "Propose sub-task — needs @assignee's approval" and
 *               calls proposeSubtask instead of addSubtask
 *               (Phase 41.4.6).
 *
 * The detail-load goes through `getItem` (or `listOpen` filtered by
 * id) — V1 doesn't have a single-item lookup skill so we use
 * useSkillResult on listOpen and pick the matching id; ItemStores
 * are tiny enough that this is fine for V1.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Alert, Modal,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { useTheme }     from '@canopy/react-native/theme';
import { ConfirmModal } from '@canopy/react-native/components';

import { useService }     from '../ServiceContext.js';
import { useSkill, useSkillResult } from '../lib/useSkill.js';
import { useI18n }        from '../I18nProvider.js';
import {
  describeTaskStatus,
  shouldOfferForceComplete,
  shouldProposeSubtask,
} from '../lib/taskStatus.js';

export function TaskDetailScreen() {
  const nav   = useNavigation();
  const route = useRoute();
  const svc   = useService();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const id = route?.params?.id;

  // Lookup. V1 ships listOpen + listMine; we call listOpen and find
  // the matching id. (A future getItem skill would replace this.)
  const list = useSkillResult('listOpen', {}, [svc?.activeCrewId, id]);

  const task = useMemo(() => {
    const items = Array.isArray(list?.data?.items) ? list.data.items : [];
    return items.find((it) => it?.id === id) ?? null;
  }, [list?.data, id]);

  const status = useMemo(() => task ? describeTaskStatus(task) : null, [task]);
  const actor  = svc?.identity?.webid ?? svc?.identity?.pubKey ?? null;
  const role   = actor ? svc?.crews?.get(svc?.activeCrewId)?.roles?.[actor] : null;
  const isAdmin = role === 'admin' || role === 'coordinator';

  const [error, setError] = useState(null);
  const [showForce, setShowForce] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const [showReject,  setShowReject]  = useState(false);
  const [rejectNote,  setRejectNote]  = useState('');
  const [showSubtask, setShowSubtask] = useState(false);
  const [subtaskText, setSubtaskText] = useState('');

  // Skill bindings
  const claim       = useSkill('claimTask');
  const complete    = useSkill('completeTask');
  const submit      = useSkill('submitTask');
  const approve     = useSkill('approveTask');
  const reject      = useSkill('rejectTask');
  const forceClose  = useSkill('forceCompleteTask');
  const addSubtask  = useSkill('addSubtask');
  const proposeSub  = useSkill('proposeSubtask');

  const _withErr = useCallback(async (fn) => {
    setError(null);
    try {
      const r = await fn();
      if (r?.error) {
        setError(r.error);
        return false;
      }
      list.refresh().catch(() => {});
      return true;
    } catch (err) {
      setError(err?.message ?? String(err));
      return false;
    }
  }, [list]);

  const onClaim    = useCallback(() => _withErr(() => claim.call({ id })),    [_withErr, claim, id]);
  const onSubmit   = useCallback(() => _withErr(() => submit.call({ id })),   [_withErr, submit, id]);
  const onApprove  = useCallback(() => _withErr(() => approve.call({ id })),  [_withErr, approve, id]);
  const onComplete = useCallback(() => _withErr(() => complete.call({ id })), [_withErr, complete, id]);

  const onReject = useCallback(async () => {
    if (!rejectNote.trim()) return;
    const ok = await _withErr(() => reject.call({ id, note: rejectNote.trim() }));
    if (ok) { setShowReject(false); setRejectNote(''); }
  }, [_withErr, reject, id, rejectNote]);

  const onForceComplete = useCallback(async () => {
    if (!forceReason.trim()) return;
    const ok = await _withErr(() => forceClose.call({ id, reason: forceReason.trim() }));
    if (ok) { setShowForce(false); setForceReason(''); }
  }, [_withErr, forceClose, id, forceReason]);

  const onAddSubtask = useCallback(async () => {
    if (!subtaskText.trim()) return;
    const propose = shouldProposeSubtask(task, actor);
    const ok = await _withErr(() => (propose ? proposeSub : addSubtask).call({
      parentTaskId: id,
      partial:      { text: subtaskText.trim() },
    }));
    if (ok) { setShowSubtask(false); setSubtaskText(''); }
  }, [_withErr, addSubtask, proposeSub, id, subtaskText, task, actor]);

  if (!task) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.background, padding: SPACING.xl }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.md }}>
          {list?.loading ? '…' : t('mobile.task_detail.no_open_tasks')}
        </Text>
      </View>
    );
  }

  const pillBg = COLORS[status.colorKey] ?? COLORS.textMuted;
  const offerForceComplete = shouldOfferForceComplete(task, actor, role);
  const proposeMode = shouldProposeSubtask(task, actor);

  return (
    <ScrollView
      contentContainerStyle={{ padding: SPACING.xl, backgroundColor: COLORS.background }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md }}>
        <View style={{
          backgroundColor: pillBg,
          borderRadius:    RADII.pill,
          paddingVertical:   2,
          paddingHorizontal: SPACING.sm,
          marginRight:     SPACING.sm,
        }}>
          <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.xs, fontWeight: '600' }}>
            {t(`mobile.workspace.status_${status.kind}`, status.label)}
          </Text>
        </View>
      </View>

      <Text style={{
        fontSize:    FONT_SIZES.xl,
        fontWeight:  '600',
        color:       COLORS.text,
        marginBottom: SPACING.md,
      }}>
        {task.text}
      </Text>

      {status.depsBlocked && status.openDepIds.length > 0 ? (
        <View style={{
          padding: SPACING.md, borderRadius: RADII.sm,
          backgroundColor: COLORS.surfaceMuted, marginBottom: SPACING.md,
        }}>
          <Text style={{ color: COLORS.warning, fontSize: FONT_SIZES.sm }}>
            {t('mobile.task_detail.mark_complete_blocked', null)
              .replace('{ids}', status.openDepIds.join(', '))}
          </Text>
        </View>
      ) : null}

      {Array.isArray(task.reviewLog) && task.reviewLog.length > 0 ? (
        <View style={{ marginBottom: SPACING.md }}>
          {task.reviewLog.map((entry, idx) => (
            <Text key={idx} style={{
              fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: 2,
            }}>
              {_formatReviewEntry(entry, t)}
            </Text>
          ))}
        </View>
      ) : null}

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md }}>
          {error}
        </Text>
      ) : null}

      <View style={{ gap: SPACING.sm }}>
        {/* Per-state primary actions */}
        {status.kind === 'ready' ? (
          <Action label={t('mobile.task_detail.claim')} onPress={onClaim} />
        ) : null}
        {status.kind === 'claimed' && status.isAssignee(actor) ? (
          <>
            {task.approval && task.approval !== 'self-mark' ? (
              <Action label={t('mobile.task_detail.submit')} onPress={onSubmit} />
            ) : (
              <Action
                label={t('mobile.task_detail.mark_complete')}
                onPress={onComplete}
                disabled={!status.canClose}
              />
            )}
          </>
        ) : null}
        {status.kind === 'submitted' && (status.isMaster(actor) || isAdmin) ? (
          <>
            <Action
              label={t('mobile.task_detail.approve')}
              onPress={onApprove}
              disabled={!status.canClose}
            />
            <Action
              label={t('mobile.task_detail.reject')}
              variant="danger"
              onPress={() => setShowReject(true)}
            />
          </>
        ) : null}

        {/* V2.7 Force-complete (admin override) */}
        {offerForceComplete ? (
          <Action
            label={t('mobile.task_detail.force_complete')}
            variant="danger"
            onPress={() => setShowForce(true)}
          />
        ) : null}

        {/* Sub-task / propose */}
        {status.kind !== 'complete' ? (
          <Action
            label={proposeMode
              ? t('mobile.task_detail.propose_subtask', null).replace('{assignee}', _suffix(task.assignee))
              : t('mobile.task_detail.add_subtask')}
            variant="secondary"
            onPress={() => setShowSubtask(true)}
          />
        ) : null}
      </View>

      {/* Reject modal */}
      <ReasonModal
        visible={showReject}
        title={t('mobile.task_detail.reject')}
        label={t('mobile.task_detail.reject_reason')}
        value={rejectNote}
        onChange={setRejectNote}
        onConfirm={onReject}
        onCancel={() => { setShowReject(false); setRejectNote(''); }}
        destructive
      />

      {/* V2.7 Force-complete reason modal */}
      <ReasonModal
        visible={showForce}
        title={t('mobile.task_detail.force_complete_confirm')}
        body={t('mobile.task_detail.force_complete_body')}
        label={t('mobile.task_detail.force_complete_reason')}
        value={forceReason}
        onChange={setForceReason}
        onConfirm={onForceComplete}
        onCancel={() => { setShowForce(false); setForceReason(''); }}
        destructive
      />

      {/* Sub-task / propose modal */}
      <ReasonModal
        visible={showSubtask}
        title={proposeMode ? t('mobile.task_detail.propose_subtask', '').replace('{assignee}', _suffix(task.assignee)) : t('mobile.task_detail.add_subtask')}
        label={t('mobile.compose.text_label')}
        value={subtaskText}
        onChange={setSubtaskText}
        onConfirm={onAddSubtask}
        onCancel={() => { setShowSubtask(false); setSubtaskText(''); }}
      />
    </ScrollView>
  );
}

/** ── Helpers ────────────────────────────────────────────────────── */

function Action({ label, onPress, variant = 'primary', disabled }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const bg = disabled ? COLORS.surfaceMuted
           : variant === 'danger' ? COLORS.danger
           : variant === 'secondary' ? COLORS.surface
           : COLORS.primary;
  const fg = disabled ? COLORS.textMuted
           : variant === 'secondary' ? COLORS.text
           : COLORS.textInverse;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`task-action-${label}`}
      style={({ pressed }) => [
        {
          paddingVertical: SPACING.lg,
          paddingHorizontal: SPACING.lg,
          borderRadius: RADII.md,
          alignItems: 'center',
          backgroundColor: bg,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: COLORS.border,
        },
        pressed && !disabled && { opacity: 0.85 },
      ]}
    >
      <Text style={{ color: fg, fontSize: FONT_SIZES.md, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function ReasonModal({ visible, title, body, label, value, onChange, onConfirm, onCancel, destructive }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View style={{
        flex: 1, alignItems: 'center', justifyContent: 'center',
        backgroundColor: COLORS.overlay, padding: SPACING.lg,
      }}>
        <View style={{
          width: '100%', maxWidth: 420,
          backgroundColor: COLORS.surface, borderRadius: RADII.md, padding: SPACING.xl,
        }}>
          <Text style={{ fontSize: FONT_SIZES.lg, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm }}>
            {title}
          </Text>
          {body ? (
            <Text style={{
              fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.md, lineHeight: 20,
            }}>
              {body}
            </Text>
          ) : null}
          <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.text, marginBottom: SPACING.sm }}>
            {label}
          </Text>
          <TextInput
            value={value}
            onChangeText={onChange}
            multiline
            autoFocus
            accessibilityLabel="reason-input"
            style={{
              minHeight: 80,
              borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
              padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
              backgroundColor: COLORS.surface, textAlignVertical: 'top',
            }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACING.lg }}>
            <Pressable
              onPress={onCancel}
              style={{
                paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
                borderRadius: RADII.sm, marginLeft: SPACING.sm,
                backgroundColor: COLORS.surfaceMuted,
              }}
              accessibilityRole="button"
            >
              <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md }}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={!value?.trim()}
              style={{
                paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
                borderRadius: RADII.sm, marginLeft: SPACING.sm,
                backgroundColor: !value?.trim()
                  ? COLORS.surfaceMuted
                  : (destructive ? COLORS.danger : COLORS.primary),
              }}
              accessibilityRole="button"
              accessibilityLabel="reason-confirm"
            >
              <Text style={{
                color: !value?.trim() ? COLORS.textMuted : COLORS.textInverse,
                fontSize: FONT_SIZES.md, fontWeight: '600',
              }}>
                OK
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function _formatReviewEntry(entry, t) {
  if (!entry) return '';
  const by = _suffix(entry.by ?? entry.actor ?? '');
  if (entry.action === 'submit')   return t('mobile.task_detail.reviewLog_submitted', '').replace('{by}', by);
  if (entry.action === 'reject')   return t('mobile.task_detail.reviewLog_rejected', '').replace('{by}', by).replace('{note}', entry.note ?? '');
  if (entry.action === 'approve')  return t('mobile.task_detail.reviewLog_approved', '').replace('{by}', by);
  return `${entry.action ?? '?'} by @${by}`;
}

function _suffix(webid) {
  if (typeof webid !== 'string') return '?';
  const i = webid.lastIndexOf('/');
  return i >= 0 ? webid.slice(i + 1) : webid;
}

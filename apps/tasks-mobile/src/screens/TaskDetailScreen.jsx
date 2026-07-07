/**
 * TaskDetailScreen — full-screen detail view.
 *
 * Phase 41.4.2 (2026-05-09); 41.18.1 (2026-05-10) — adds the desktop-
 * parity admin/master CTAs that the V0 build only exposed on the
 * web: revoke, reassign, remove, setApprovalMode + the
 * forceSpawnSubtask shortcut (the latter routes to ComposeScreen
 * with `forceSpawn: true`).
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
 *   - admin / master overrides (41.18.1):
 *       - Revoke (master/admin/coordinator) — claimed → ready, with
 *         a mandatory reason.
 *       - Reassign (admin/coordinator) — pick a new webid from the
 *         crew via `MemberPickerSheet`. Pass `null` to clear.
 *       - Remove (admin only) — destructive confirm.
 *       - Change approval-mode (master) — auto / approval / dual.
 *       - Force-spawn sub-task (admin) — routes to ComposeScreen
 *         with `forceSpawn: true` so the dedicated form collects
 *         the mandatory reason.
 *
 * The detail-load goes through `listOpen` (we pick the matching id)
 * for open tasks. For tasks that have moved into `complete` /
 * `rejected` state we also peek the `getDagTree` result (which
 * includes closed items) — same pattern the desktop uses on the
 * task-detail modal.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Modal, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { useTheme }     from '@canopy/react-native/theme';
import { ConfirmModal } from '@canopy/react-native/components';

import { useService }     from '../ServiceContext.js';
import { useSkill, useSkillResult } from '../lib/useSkill.js';
import { useLocalisation }        from '../LocalisationProvider.js';
import {
  describeTaskStatus,
  shouldOfferForceComplete,
  shouldProposeSubtask,
} from '../lib/taskStatus.js';
import { ROUTES } from '../navigation.js';
import { MemberPickerSheet } from '../components/MemberPickerSheet.jsx';
import { resolveActorRole } from '@canopy-app/tasks-v0/ui/effectiveActor';

export function TaskDetailScreen() {
  const nav   = useNavigation();
  const route = useRoute();
  const svc   = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const id = route?.params?.id;

  // Lookup. V1 ships listOpen + listMine; we call listOpen and find
  // the matching id. (A future getItem skill would replace this.)
  const list = useSkillResult('listOpen', {}, [svc?.activeCircleId, id]);

  const task = useMemo(() => {
    const items = Array.isArray(list?.data?.items) ? list.data.items : [];
    return items.find((it) => it?.id === id) ?? null;
  }, [list?.data, id]);

  // 41.18 follow-up — parent reference + sub-task list. Both lookups
  // run on the same listOpen payload so we don't fire extra skills.
  // (Closed tasks are out of scope here; the V1 surface assumes
  // parent + sub-tasks live in the same open set during real
  // interaction. A future enrichment can call listClosed too.)
  const parentTask = useMemo(() => {
    const pid = task?.parentTaskId;
    if (typeof pid !== 'string' || !pid) return null;
    const items = Array.isArray(list?.data?.items) ? list.data.items : [];
    return items.find((it) => it?.id === pid) ?? null;
  }, [list?.data, task?.parentTaskId]);

  const subtasks = useMemo(() => {
    if (!task?.id) return [];
    const items = Array.isArray(list?.data?.items) ? list.data.items : [];
    return items.filter((it) => it?.parentTaskId === task.id);
  }, [list?.data, task?.id]);

  const status = useMemo(() => task ? describeTaskStatus(task) : null, [task]);
  const actor  = svc?.identity?.webid ?? svc?.identity?.pubKey ?? null;
  const cs     = svc?.crews?.get?.(svc?.activeCircleId);
  // 41.18 follow-up — pubKey ↔ webid resolution via the shared
  // helper so mobile + desktop stay in step. See
  // `apps/tasks-v0/src/ui/effectiveActor.js`.
  const role = resolveActorRole({ from: actor, crewState: cs });
  const isAdmin       = role === 'admin' || role === 'coordinator';
  const isAdminOnly   = role === 'admin';
  const members       = cs?.liveCrew?.members ?? [];

  const isMaster = task && actor &&
    (task.master === actor || task.addedBy === actor);

  const [error, setError] = useState(null);
  const [showForce, setShowForce] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const [showReject,  setShowReject]  = useState(false);
  const [rejectNote,  setRejectNote]  = useState('');
  const [showSubtask, setShowSubtask] = useState(false);
  const [subtaskText, setSubtaskText] = useState('');

  // 41.18.1 admin/master overrides
  const [showRevoke,    setShowRevoke]   = useState(false);
  const [revokeReason,  setRevokeReason] = useState('');
  const [showReassign,  setShowReassign] = useState(false);
  const [showRemove,    setShowRemove]   = useState(false);
  const [showApproval,  setShowApproval] = useState(false);

  // #226 (2026-05-24) — editTask UI affordance. Visible when the
  // task is in `ready`/`open` or `claimed` state. The form patches
  // text + notes through the substrate's editTask skill (#219).
  const [showEdit,      setShowEdit]     = useState(false);
  const [editText,      setEditText]     = useState('');
  const [editNotes,     setEditNotes]    = useState('');

  // Skill bindings
  const claim       = useSkill('claimTask');
  const complete    = useSkill('completeTask');
  const submit      = useSkill('submitTask');
  const approve     = useSkill('approveTask');
  const reject      = useSkill('rejectTask');
  const forceClose  = useSkill('forceCompleteTask');
  const addSubtask  = useSkill('addSubtask');
  const proposeSub  = useSkill('proposeSubtask');
  // 41.18.1 admin/master skills
  const revokeSk    = useSkill('revokeTask');
  const reassignSk  = useSkill('reassignTask');
  const removeSk    = useSkill('removeTask');
  const setApproval = useSkill('setApprovalMode');
  // #226 — editTask skill binding.
  const edit        = useSkill('editTask');

  const [busyAction, setBusyAction] = useState(null); // skill name or null

  const _withErr = useCallback(async (skillName, fn) => {
    setError(null);
    setBusyAction(skillName);
    try {
      const r = await fn();
      // 41.18 follow-up — log every skill result so we can see why a
      // tap appears to do nothing on a real device. The mobile app
      // re-uses the desktop skill bodies which return shape-varied
      // results; surface the whole thing.
      // eslint-disable-next-line no-console
      console.log(`[skill ${skillName}] result =`, JSON.stringify(r));
      // Top-level error (dispatch-level)
      if (r?.error) {
        setError(`${skillName}: ${r.error}`);
        return false;
      }
      // Nested error (skill returns {result: {error: ...}}).
      if (r?.result && typeof r.result === 'object' && r.result.error) {
        setError(`${skillName}: ${r.result.error}`);
        return false;
      }
      await list.refresh().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[list.refresh] failed:', err?.message ?? err);
      });
      return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[skill ${skillName}] threw:`, err?.message ?? err);
      setError(`${skillName}: ${err?.message ?? String(err)}`);
      return false;
    } finally {
      setBusyAction(null);
    }
  }, [list]);

  const onClaim    = useCallback(() => _withErr('claimTask',    () => claim.call({ id })),    [_withErr, claim, id]);
  const onSubmit   = useCallback(() => _withErr('submitTask',   () => submit.call({ id })),   [_withErr, submit, id]);
  const onApprove  = useCallback(() => _withErr('approveTask',  () => approve.call({ id })),  [_withErr, approve, id]);
  const onComplete = useCallback(() => _withErr('completeTask', () => complete.call({ id })), [_withErr, complete, id]);

  const onReject = useCallback(async () => {
    if (!rejectNote.trim()) return;
    const ok = await _withErr('rejectTask', () => reject.call({ id, note: rejectNote.trim() }));
    if (ok) { setShowReject(false); setRejectNote(''); }
  }, [_withErr, reject, id, rejectNote]);

  const onForceComplete = useCallback(async () => {
    if (!forceReason.trim()) return;
    const ok = await _withErr('forceCompleteTask',
      () => forceClose.call({ id, reason: forceReason.trim() }));
    if (ok) { setShowForce(false); setForceReason(''); }
  }, [_withErr, forceClose, id, forceReason]);

  const onAddSubtask = useCallback(async () => {
    if (!subtaskText.trim()) return;
    const propose = shouldProposeSubtask(task, actor);
    // addSubtask + proposeSubtask take FLAT args (parentTaskId,
    // text, …) — not a `partial` wrapper. Earlier code passed
    // `{partial: {text}}` and the skill silently rejected on the
    // missing `text` field.
    const ok = await _withErr(propose ? 'proposeSubtask' : 'addSubtask',
      () => (propose ? proposeSub : addSubtask).call({
        parentTaskId: id,
        text:         subtaskText.trim(),
      }));
    if (ok) { setShowSubtask(false); setSubtaskText(''); }
  }, [_withErr, addSubtask, proposeSub, id, subtaskText, task, actor]);

  // 41.18.1 admin/master overrides
  const onRevoke = useCallback(async () => {
    if (!revokeReason.trim()) return;
    const ok = await _withErr('revokeTask',
      () => revokeSk.call({ id, reason: revokeReason.trim() }));
    if (ok) { setShowRevoke(false); setRevokeReason(''); }
  }, [_withErr, revokeSk, id, revokeReason]);

  const onReassign = useCallback(async (newAssignee) => {
    setShowReassign(false);
    const arg = newAssignee === '__clear__' ? null : newAssignee;
    await _withErr('reassignTask', () => reassignSk.call({ id, newAssignee: arg }));
  }, [_withErr, reassignSk, id]);

  const onRemove = useCallback(async () => {
    const ok = await _withErr('removeTask', () => removeSk.call({ id }));
    if (ok) {
      setShowRemove(false);
      nav.goBack();
    }
  }, [_withErr, removeSk, id, nav]);

  const onSetApprovalMode = useCallback(async (mode) => {
    setShowApproval(false);
    await _withErr('setApprovalMode', () => setApproval.call({ id, mode }));
  }, [_withErr, setApproval, id]);

  // #226 — editTask: open the form pre-filled with the current task
  // body. The form patches only the fields the user actually changes
  // (the skill rejects an empty patch). Forbidden lifecycle fields
  // (assignee / claimedAt / completedAt / id / addedBy / reviewLog /
  // deliverable / approval / master / parentTaskId) are NOT in this
  // form — those have dedicated CTAs above.
  const onOpenEdit = useCallback(() => {
    setEditText(task?.text ?? '');
    setEditNotes(task?.notes ?? '');
    setError(null);
    setShowEdit(true);
  }, [task?.text, task?.notes]);

  const onSubmitEdit = useCallback(async () => {
    if (!task) return;
    // Build a patch with only the fields that actually changed so a
    // no-op submit hits the substrate's 'no fields to update' guard
    // and surfaces a clear error instead of writing a null-edit.
    const patch = { id };
    if ((task.text ?? '') !== editText)  patch.text  = editText;
    if ((task.notes ?? '') !== editNotes) patch.notes = editNotes;
    const ok = await _withErr('editTask', () => edit.call(patch));
    if (ok) {
      setShowEdit(false);
      setEditText('');
      setEditNotes('');
    }
  }, [_withErr, edit, id, task, editText, editNotes]);

  const onForceSpawnSubtask = useCallback(() => {
    nav.navigate(ROUTES.Compose, { parent: id, forceSpawn: true });
  }, [nav, id]);

  const onAddSubtaskNav = useCallback(() => {
    nav.navigate(ROUTES.Compose, { parent: id });
  }, [nav, id]);

  // 41.18.4 — Appeal: route into ChatThreadScreen with the appeal-id
  // shape used by tasks-v0's appealTask skill (`appeal:<taskId>`).
  // The first message-send from the screen calls appealTask, which
  // opens the thread with the master and pre-fills the revoke
  // reason. Subsequent messages route through sendChatMessage.
  const onOpenAppeal = useCallback(() => {
    nav.navigate(ROUTES.ChatThread, {
      threadId:        `appeal:${id}`,
      counterparty:    task?.master ?? task?.addedBy ?? null,
      appealForTaskId: id,
    });
  }, [nav, id, task]);

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

  // 41.18.4 — Appeal CTA shows when the most-recent reviewLog entry
  // is a revoke. The substrate gates eligibility (caller-was-prev-
  // assignee + ≤ 7-day window); the UI is permissive — surface the
  // affordance whenever a revoke happened so the assignee can find
  // it. Errors land in the chat-thread send path.
  const lastReview = Array.isArray(task?.reviewLog) && task.reviewLog.length > 0
    ? task.reviewLog[task.reviewLog.length - 1]
    : null;
  const offerAppeal = lastReview?.decision === 'revoke';

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

      {/* 41.18 follow-up — parent reference. Tap to navigate up. */}
      {task.parentTaskId ? (
        <Pressable
          onPress={() => nav.navigate(ROUTES.TaskDetail, { id: task.parentTaskId })}
          accessibilityRole="button"
          accessibilityLabel="task-detail-parent-link"
          style={({ pressed }) => [
            {
              flexDirection: 'row', alignItems: 'center',
              padding: SPACING.sm,
              borderRadius: RADII.sm,
              backgroundColor: COLORS.surfaceMuted,
              marginBottom: SPACING.md,
            },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginRight: SPACING.xs }}>
            ↳
          </Text>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: COLORS.text, fontSize: FONT_SIZES.sm, fontWeight: '500',
            }}
          >
            {parentTask
              ? t('mobile.task_detail.subtask_of', null).replace('{text}', parentTask.text ?? '(untitled)')
              : t('mobile.task_detail.subtask_of_id', null).replace('{id}', _suffix(task.parentTaskId))}
          </Text>
        </Pressable>
      ) : null}

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

      {/* 41.18 follow-up — sub-tasks list. Each row links to its
          own TaskDetail. Status pill mirrors the top-level pill so
          the user can see at a glance which children are blocking. */}
      {subtasks.length > 0 ? (
        <View style={{
          marginBottom: SPACING.md,
          padding: SPACING.md,
          borderRadius: RADII.sm,
          backgroundColor: COLORS.surfaceMuted,
        }}>
          <Text style={{
            fontSize: FONT_SIZES.xs,
            textTransform: 'uppercase',
            letterSpacing: 1,
            color: COLORS.textMuted,
            marginBottom: SPACING.sm,
          }}>
            {t('mobile.task_detail.subtasks_label', null).replace('{count}', String(subtasks.length))}
          </Text>
          {subtasks.map((sub) => {
            const subStatus = describeTaskStatus(sub);
            const pillBg = COLORS[subStatus.colorKey] ?? COLORS.textMuted;
            return (
              <Pressable
                key={sub.id}
                onPress={() => nav.navigate(ROUTES.TaskDetail, { id: sub.id })}
                accessibilityRole="button"
                accessibilityLabel={`task-detail-subtask-${sub.id}`}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row', alignItems: 'center',
                    paddingVertical: SPACING.sm,
                    borderTopWidth: 1, borderTopColor: COLORS.border,
                  },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <View style={{
                  paddingVertical: 2, paddingHorizontal: SPACING.sm,
                  borderRadius: RADII.pill,
                  backgroundColor: pillBg,
                  marginRight: SPACING.sm,
                }}>
                  <Text style={{
                    color: COLORS.textInverse,
                    fontSize: FONT_SIZES.xs, fontWeight: '600',
                  }}>
                    {t(`mobile.workspace.status_${subStatus.kind}`, subStatus.label)}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, color: COLORS.text, fontSize: FONT_SIZES.sm }}
                >
                  {sub.text ?? '(untitled)'}
                </Text>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.lg, marginLeft: SPACING.sm }}>
                  ›
                </Text>
              </Pressable>
            );
          })}
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
          <Action
            label={t('mobile.task_detail.claim')}
            onPress={onClaim}
            busy={busyAction === 'claimTask'}
          />
        ) : null}
        {status.kind === 'claimed' && status.isAssignee(actor) ? (
          <>
            {task.approval && task.approval !== 'self-mark' ? (
              <Action
                label={t('mobile.task_detail.submit')}
                onPress={onSubmit}
                busy={busyAction === 'submitTask'}
              />
            ) : (
              <Action
                label={t('mobile.task_detail.mark_complete')}
                onPress={onComplete}
                disabled={!status.canClose}
                busy={busyAction === 'completeTask'}
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
              busy={busyAction === 'approveTask'}
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

        {/* #226 — Edit task body. Visible when the task is open
            (ready / waiting / blocked) or claimed. Submitted /
            complete / rejected tasks intentionally do NOT expose
            edit here: those have dedicated lifecycle CTAs and the
            substrate's editTask doesn't model lifecycle-aware
            permissions yet (gating happens via canEditBody +
            crew paused/archived). */}
        {(status.kind === 'ready' || status.kind === 'waiting'
          || status.kind === 'blocked' || status.kind === 'claimed') ? (
          <Action
            label={t('mobile.task_detail.edit')}
            variant="secondary"
            onPress={onOpenEdit}
          />
        ) : null}

        {/* Sub-task / propose */}
        {status.kind !== 'complete' ? (
          <Action
            label={proposeMode
              ? t('mobile.task_detail.propose_subtask', null).replace('{assignee}', _suffix(task.assignee))
              : t('mobile.task_detail.add_subtask')}
            variant="secondary"
            onPress={onAddSubtaskNav}
          />
        ) : null}

        {/* 41.18.4 — Appeal a revoke (within 7 days) */}
        {offerAppeal ? (
          <Action
            label={t('mobile.task_detail.appeal')}
            variant="secondary"
            onPress={onOpenAppeal}
          />
        ) : null}

        {/* 41.18.1 — admin / master override row */}
        {(isAdmin || isMaster) && status.kind !== 'complete' ? (
          <View style={{
            marginTop: SPACING.md,
            paddingTop: SPACING.md,
            borderTopWidth: 1,
            borderTopColor: COLORS.border,
            gap: SPACING.sm,
          }}>
            <Text style={{
              color: COLORS.textMuted, fontSize: FONT_SIZES.xs,
              textTransform: 'uppercase', letterSpacing: 1,
            }}>
              {t('mobile.task_detail.admin_section')}
            </Text>

            {/* Revoke — only when claimed (master/admin) */}
            {status.kind === 'claimed' && (isAdmin || isMaster) ? (
              <Action
                label={t('mobile.task_detail.revoke')}
                variant="secondary"
                onPress={() => setShowRevoke(true)}
              />
            ) : null}

            {/* Reassign — admin/coordinator */}
            {isAdmin ? (
              <Action
                label={t('mobile.task_detail.reassign')}
                variant="secondary"
                onPress={() => setShowReassign(true)}
              />
            ) : null}

            {/* Change approval-mode — master */}
            {isMaster ? (
              <Action
                label={t('mobile.task_detail.set_approval_mode', null)
                  .replace('{mode}', task.approval ?? '—')}
                variant="secondary"
                onPress={() => setShowApproval(true)}
              />
            ) : null}

            {/* Force-spawn sub-task — admin only, opens Compose */}
            {isAdminOnly ? (
              <Action
                label={t('mobile.task_detail.force_spawn_subtask')}
                variant="secondary"
                onPress={onForceSpawnSubtask}
              />
            ) : null}

            {/* Remove — admin only, destructive */}
            {isAdminOnly ? (
              <Action
                label={t('mobile.task_detail.remove')}
                variant="danger"
                onPress={() => setShowRemove(true)}
              />
            ) : null}
          </View>
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

      {/* Sub-task / propose modal — kept for the inline path used
          by quick-add (the button now navigates to Compose, but the
          modal still opens when the deprecated direct path is hit
          via tests). The screen-level CTA now uses onAddSubtaskNav. */}
      <ReasonModal
        visible={showSubtask}
        title={proposeMode ? t('mobile.task_detail.propose_subtask', '').replace('{assignee}', _suffix(task.assignee)) : t('mobile.task_detail.add_subtask')}
        label={t('mobile.compose.text_label')}
        value={subtaskText}
        onChange={setSubtaskText}
        onConfirm={onAddSubtask}
        onCancel={() => { setShowSubtask(false); setSubtaskText(''); }}
      />

      {/* 41.18.1 — Revoke reason modal */}
      <ReasonModal
        visible={showRevoke}
        title={t('mobile.task_detail.revoke')}
        body={t('mobile.task_detail.revoke_body')}
        label={t('mobile.task_detail.revoke_reason')}
        value={revokeReason}
        onChange={setRevokeReason}
        onConfirm={onRevoke}
        onCancel={() => { setShowRevoke(false); setRevokeReason(''); }}
        destructive
      />

      {/* 41.18.1 — Reassign picker */}
      <MemberPickerSheet
        visible={showReassign}
        title={t('mobile.task_detail.reassign_picker_title')}
        items={[
          { id: '__clear__', label: t('mobile.task_detail.reassign_clear') },
          ...members.map((m) => ({
            id:    m.webid,
            label: m.displayName ?? _suffix(m.webid),
            sub:   `@${_suffix(m.webid)}`,
          })),
        ]}
        selected={task?.assignee ?? null}
        onSelect={(webid) => onReassign(webid)}
        onCancel={() => setShowReassign(false)}
      />

      {/* 41.18.1 — Remove destructive confirm */}
      <ConfirmModal
        visible={showRemove}
        title={t('mobile.task_detail.remove_confirm_title')}
        body={t('mobile.task_detail.remove_confirm_body')}
        confirmLabel={t('mobile.task_detail.remove')}
        destructive
        onConfirm={onRemove}
        onCancel={() => setShowRemove(false)}
      />

      {/* 41.18.1 — Approval-mode picker */}
      <MemberPickerSheet
        visible={showApproval}
        title={t('mobile.task_detail.approval_mode_title')}
        items={[
          { id: 'auto',           label: t('mobile.compose.approval_auto') },
          { id: 'approval',       label: t('mobile.compose.approval_single') },
          { id: 'dual-approval',  label: t('mobile.compose.approval_dual') },
        ]}
        selected={task?.approval ?? null}
        onSelect={(mode) => onSetApprovalMode(mode)}
        onCancel={() => setShowApproval(false)}
      />

      {/* #226 — Edit task body modal (text + notes). */}
      <EditTaskModal
        visible={showEdit}
        title={t('mobile.task_detail.edit_title')}
        textLabel={t('mobile.task_detail.edit_text_label')}
        notesLabel={t('mobile.task_detail.edit_notes_label')}
        cancelLabel={t('mobile.task_detail.edit_cancel')}
        saveLabel={t('mobile.task_detail.edit_save')}
        busy={busyAction === 'editTask'}
        text={editText}
        notes={editNotes}
        onChangeText={setEditText}
        onChangeNotes={setEditNotes}
        onConfirm={onSubmitEdit}
        onCancel={() => {
          setShowEdit(false);
          setEditText('');
          setEditNotes('');
        }}
      />
    </ScrollView>
  );
}

/** ── Helpers ────────────────────────────────────────────────────── */

function Action({ label, onPress, variant = 'primary', disabled, busy }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const isDisabled = disabled || busy;
  const bg = isDisabled ? COLORS.surfaceMuted
           : variant === 'danger' ? COLORS.danger
           : variant === 'secondary' ? COLORS.surface
           : COLORS.primary;
  const fg = isDisabled ? COLORS.textMuted
           : variant === 'secondary' ? COLORS.text
           : COLORS.textInverse;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
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
          flexDirection: 'row', justifyContent: 'center',
        },
        pressed && !isDisabled && { opacity: 0.85 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} style={{ marginRight: 8 }} />
      ) : null}
      <Text style={{ color: fg, fontSize: FONT_SIZES.md, fontWeight: '600' }}>
        {busy ? '…' : label}
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

/**
 * EditTaskModal — #226 (2026-05-24) — two-field form (text + notes)
 * for editTask. Sibling of `ReasonModal` above but with two inputs
 * and a Save/Cancel pair labelled via t() entries. All copy is
 * supplied by the caller so this stays locale-agnostic.
 *
 * Save is disabled when the text field is empty (we never want to
 * patch a task to an empty title) and while the dispatch is in
 * flight (`busy`).
 */
function EditTaskModal({
  visible, title, textLabel, notesLabel,
  cancelLabel, saveLabel, busy,
  text, notes, onChangeText, onChangeNotes,
  onConfirm, onCancel,
}) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  if (!visible) return null;
  const canSave = typeof text === 'string' && text.trim().length > 0 && !busy;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View style={{
        flex: 1, alignItems: 'center', justifyContent: 'center',
        backgroundColor: COLORS.overlay, padding: SPACING.lg,
      }}>
        <View style={{
          width: '100%', maxWidth: 480,
          backgroundColor: COLORS.surface, borderRadius: RADII.md, padding: SPACING.xl,
        }}>
          <Text style={{
            fontSize: FONT_SIZES.lg, fontWeight: '600',
            color: COLORS.text, marginBottom: SPACING.md,
          }}>
            {title}
          </Text>

          <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.text, marginBottom: SPACING.xs }}>
            {textLabel}
          </Text>
          <TextInput
            value={text}
            onChangeText={onChangeText}
            autoFocus
            accessibilityLabel="edit-task-text"
            style={{
              minHeight: 44,
              borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
              padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
              backgroundColor: COLORS.surface, marginBottom: SPACING.md,
            }}
          />

          <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.text, marginBottom: SPACING.xs }}>
            {notesLabel}
          </Text>
          <TextInput
            value={notes}
            onChangeText={onChangeNotes}
            multiline
            accessibilityLabel="edit-task-notes"
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
              disabled={busy}
              style={{
                paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
                borderRadius: RADII.sm, marginLeft: SPACING.sm,
                backgroundColor: COLORS.surfaceMuted,
                opacity: busy ? 0.5 : 1,
              }}
              accessibilityRole="button"
              accessibilityLabel="edit-task-cancel"
            >
              <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md }}>
                {cancelLabel}
              </Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={!canSave}
              style={{
                paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
                borderRadius: RADII.sm, marginLeft: SPACING.sm,
                backgroundColor: canSave ? COLORS.primary : COLORS.surfaceMuted,
                flexDirection: 'row', alignItems: 'center',
              }}
              accessibilityRole="button"
              accessibilityLabel="edit-task-save"
            >
              {busy ? (
                <ActivityIndicator
                  color={COLORS.textInverse}
                  style={{ marginRight: 8 }}
                />
              ) : null}
              <Text style={{
                color: canSave ? COLORS.textInverse : COLORS.textMuted,
                fontSize: FONT_SIZES.md, fontWeight: '600',
              }}>
                {saveLabel}
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

/**
 * InboxScreen — list of inbox events for the active actor.
 *
 * Phase 41.6.4 (2026-05-09); 41.18.2 (2026-05-10) — adds the inbox
 * housekeeping skills the desktop has had since V1: per-row clear,
 * "Clear all", and a header badge fed by `useInboxBadge`.
 *
 * Slice C.4 (2026-05-20) — adapter-driven (fourth RN screen; mobile
 * parity for the V0.4 inbox substrate that landed on web in commit
 * 538f9d2 / B.2.3b).  Replaces three hand-rolled bits with substrate:
 *
 *   - **Data source** (V0.3 `useAdapterSection`):
 *     `listMyInbox({limit: 200})` is now resolved via
 *     `adapter.getSection('inbox').dataSource` (Q7 + V0.3 hook).
 *     Pre-C.4 the screen called `useSkillResult('listMyInbox')`
 *     directly.
 *
 *   - **Per-row buttons** (V0.4 `renderItemActions` + generic
 *     appliesTo gating):  the four subtask approve/decline ops carry
 *     `appliesTo: {type: 'inbox-item', kind: '<subtask-proposal |
 *     subtask-request>'}` (Q19+ generic-field gate in
 *     `itemMatchesAppliesTo`).  The screen tags each event with
 *     `{type: 'inbox-item', kind: kindOf(event)}` before passing to
 *     `adapter.renderItemActions(section, tagged)` so the substrate
 *     can gate by kind.  Pre-C.4 the screen had a hand-rolled
 *     `switch (kind)` block; the substrate now owns gating, the
 *     screen owns dispatch (same split as C.3 review).
 *
 *   - **Clear-all button** (V0.4 Q19 `renderSectionActions`):  the
 *     `clearInbox` op carries `surfaces.ui.placement: 'section-
 *     header'`; the section's `sectionActions[]` (filled by
 *     renderWeb's Q19 branch) is surfaced via
 *     `adapter.renderSectionActions(section)`.  Pre-C.4 the button
 *     was hand-rolled with `useSkill('clearInbox')` and an inline
 *     "Clear all" label.
 *
 *   - **Per-row "✕" clear** (V0.4 `clearInboxItem` itemAction):
 *     still flows through `renderItemActions` — its `appliesTo` has
 *     no `kind` gate so it surfaces on every event (same shape as
 *     today's per-row dismiss).  Item tag normalises every event to
 *     `type: 'inbox-item'` so the `appliesTo.type === 'inbox-item'`
 *     gate matches (raw inbox items carry `type: 'notification'` —
 *     see InAppInboxBridge.sendReply; the screen-side tag is the
 *     web-shell pattern too, mirroring inbox.html's
 *     `const tagged = { type: 'inbox-item', ...item }`).
 *
 * What stays hand-built:
 *   - **Card layouts** (SubtaskProposalCard / SubtaskRequestCard) —
 *     per-kind metadata strings (by / text) and styling are RN-only
 *     UX; the substrate decides WHICH actions surface, the screen
 *     decides WHAT chrome to render around them.
 *   - **Approve/Decline confirm modals** — destructive-action UX (the
 *     proposal-rollback warning + the decline-note input) is RN-
 *     specific.  `renderItemActions` declares the actions; the
 *     screen routes button taps through the existing modal flow
 *     before dispatching.
 *   - **Badge header** — `useInboxBadge` is a separate skill
 *     (`inboxBadgeCount`); not part of the section data source.
 *   - **Skill dispatch** — `useSkill('approveSubtaskProposal')` etc.
 *     still own activeCircleId injection + reply unwrap (same split as
 *     C.3 review: substrate declares, screen dispatches).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Modal, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { tasksManifest } from '@canopy-app/tasks-v0/manifest';

import { useTheme }       from '@canopy/react-native/theme';
import { ConfirmModal }   from '@canopy/react-native/components';
import { useService }     from '../ServiceContext.js';
import { useSkill, toParts, unwrapParts } from '../lib/useSkill.js';
import { useLocalisation }        from '../LocalisationProvider.js';
import { kindOf, proposalIdOf, requestIdOf } from '../lib/inboxClassify.js';
import { useInboxBadge }  from '../lib/useInboxBadge.js';
import { ROUTES }         from '../navigation.js';
import { createNavModelAdapter } from '../manifest-adapter.js';
import { useAdapterSection }     from '../useAdapterSection.js';

export function InboxScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  // Slice C.4 — build the NavModel adapter once per service-change.
  // Same shape as ReviewScreen (C.3); the adapter is platform-neutral
  // and the `callSkill` dispatcher feeds `fetchSection` consumers
  // (unused here — the screen uses `useAdapterSection` for the data
  // source + `useSkill` for op dispatch).
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

  // Data source resolved via the manifest's `inbox` view dataSource
  // (V0.2 Q7 — `listMyInbox` with `{limit: 200}`).  V0.3 hook owns
  // the useSkillResult plumbing.
  const { section, data, loading, refresh } =
    useAdapterSection(adapter, 'inbox', [svc?.activeCircleId]);
  const list = { data, loading, refresh };

  const approveProposal = useSkill('approveSubtaskProposal');
  const declineProposal = useSkill('declineSubtaskProposal');
  const approveRequest  = useSkill('approveSubtaskRequest');
  const declineRequest  = useSkill('declineSubtaskRequest');
  const clearOne        = useSkill('clearInboxItem');
  const clearAll        = useSkill('clearInbox');
  const badge           = useInboxBadge();

  const items = Array.isArray(list?.data?.items) ? list.data.items
              : Array.isArray(list?.data?.events) ? list.data.events
              : [];

  // Slice C.4 — V0.4 section-header CTAs (Q19).  `clearInbox` declares
  // `surfaces.ui.placement: 'section-header'`; renderWeb projects it
  // into `section.sectionActions[]`.  Pre-C.4 the button was hand-
  // rolled — now the adapter declares it + the screen routes the tap.
  const sectionActions = section ? adapter.renderSectionActions(section) : [];

  const [showClearAll, setShowClearAll] = useState(false);
  const [pendingApprove, setPendingApprove] = useState(null); // event being confirmed
  const [pendingDecline, setPendingDecline] = useState(null);
  const [declineNote, setDeclineNote] = useState('');

  const onClearItem = useCallback(async (item) => {
    const id = item?.id ?? item?.eventId ?? item?._path?.split('/').pop()?.replace(/\.json$/, '');
    if (!id) return;
    await clearOne.call({ id }).catch(() => {});
    list.refresh().catch(() => {});
    badge.refresh().catch(() => {});
  }, [clearOne, list, badge]);

  const onClearAll = useCallback(async () => {
    setShowClearAll(false);
    await clearAll.call({}).catch(() => {});
    list.refresh().catch(() => {});
    badge.refresh().catch(() => {});
  }, [clearAll, list, badge]);

  const onApproveRequest = useCallback(async (item) => {
    const requestId = requestIdOf(item);
    if (!requestId) return;
    await approveRequest.call({ requestId }).catch(() => {});
    list.refresh().catch(() => {});
    badge.refresh().catch(() => {});
  }, [approveRequest, list, badge]);

  const onDeclineRequest = useCallback(async (item) => {
    const requestId = requestIdOf(item);
    if (!requestId) return;
    await declineRequest.call({ requestId }).catch(() => {});
    list.refresh().catch(() => {});
    badge.refresh().catch(() => {});
  }, [declineRequest, list, badge]);

  const onApprove = useCallback(async () => {
    if (!pendingApprove) return;
    const proposalId = proposalIdOf(pendingApprove);
    if (!proposalId) { setPendingApprove(null); return; }
    await approveProposal.call({ proposalId }).catch(() => {});
    setPendingApprove(null);
    list.refresh().catch(() => {});
  }, [approveProposal, pendingApprove, list]);

  const onDecline = useCallback(async () => {
    if (!pendingDecline) return;
    const proposalId = proposalIdOf(pendingDecline);
    if (!proposalId) { setPendingDecline(null); return; }
    await declineProposal.call({
      proposalId,
      note: declineNote.trim() || undefined,
    }).catch(() => {});
    setPendingDecline(null);
    setDeclineNote('');
    list.refresh().catch(() => {});
  }, [declineProposal, pendingDecline, declineNote, list]);

  const onRefresh = useCallback(() => { list.refresh().catch(() => {}); }, [list]);

  /**
   * Route a manifest-declared action to its dispatcher.  The
   * substrate declares which actions surface (per-kind + state gate);
   * the screen owns HOW to dispatch (modal-confirm vs direct).  Same
   * pattern as ReviewScreen (C.3): adapter declares, screen routes.
   */
  const dispatchItemAction = useCallback((action, item) => {
    switch (action.opId) {
      case 'approveSubtaskProposal':  return setPendingApprove(item);
      case 'declineSubtaskProposal':  return setPendingDecline(item);
      case 'approveSubtaskRequest':   return onApproveRequest(item);
      case 'declineSubtaskRequest':   return onDeclineRequest(item);
      case 'clearInboxItem':          return onClearItem(item);
      default:                        return undefined;
    }
  }, [onApproveRequest, onDeclineRequest, onClearItem]);

  /**
   * Route a section-header CTA to its dispatcher.  V0.4 sectionActions
   * take no per-item args; `clearInbox` is the only one today and
   * surfaces a destructive confirm before dispatch.
   */
  const dispatchSectionAction = useCallback((action) => {
    if (action.opId === 'clearInbox') return setShowClearAll(true);
    return undefined;
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: SPACING.md, paddingTop: SPACING.md,
        paddingBottom: SPACING.sm,
        borderBottomWidth: 1, borderBottomColor: COLORS.border,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {badge.count > 0 ? (
            <View style={{
              backgroundColor: COLORS.primary,
              paddingHorizontal: SPACING.sm,
              paddingVertical: 2,
              borderRadius: RADII.pill,
              marginRight: SPACING.sm,
            }}>
              <Text style={{
                color: COLORS.textInverse,
                fontSize: FONT_SIZES.xs, fontWeight: '600',
              }}>
                {badge.count}
              </Text>
            </View>
          ) : null}
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}>
            {t('mobile.inbox.badge_summary', null)
              .replace('{recent}', String(badge.count))
              .replace('{total}', String(badge.totalCount))}
          </Text>
        </View>
        {/*
          * Slice C.4 — section-header CTAs from
          * `adapter.renderSectionActions(section)`.  Manifest declares
          * `clearInbox` with `surfaces.ui.placement: 'section-header'`;
          * the screen renders one Pressable per action.  Only surfaces
          * when items[] is non-empty (UX — no point clearing nothing).
          */}
        {items.length > 0 ? sectionActions.map((action) => (
          <Pressable
            key={action.opId}
            onPress={() => dispatchSectionAction(action)}
            accessibilityRole="button"
            accessibilityLabel={`inbox-section-${action.opId}`}
            style={{
              paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm,
              borderRadius: RADII.pill, borderWidth: 1, borderColor: COLORS.border,
            }}
          >
            <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.xs }}>
              {/* Prefer localisation for the canonical "Clear all" label; fall
                  back to the manifest's English label for any
                  forward-additive section CTAs. */}
              {action.opId === 'clearInbox'
                ? t('mobile.inbox.clear_all')
                : action.label}
            </Text>
          </Pressable>
        )) : null}
      </View>

      <FlatList
        data={items}
        keyExtractor={(it, idx) => `${it.id ?? it.eventId ?? idx}`}
        contentContainerStyle={{ padding: SPACING.md, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={!!list?.loading} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={{ padding: SPACING.xl, alignItems: 'center' }}>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.md, textAlign: 'center' }}>
              {t('mobile.inbox.empty')}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          // Tier B (2026-05-20) — InAppInboxBridge now stamps the
          // substrate-canonical shape (type: 'inbox-item' + top-level
          // kind) at write time, so items pass straight to
          // renderItemActions without a per-render synthesis step.
          const actions = section ? adapter.renderItemActions(section, item) : [];
          const kind = kindOf(item);

          if (kind === 'subtask-proposal') {
            return (
              <SubtaskProposalCard
                event={item}
                actions={actions}
                onAction={(action) => dispatchItemAction(action, item)}
              />
            );
          }
          if (kind === 'subtask-request') {
            return (
              <SubtaskRequestCard
                event={item}
                actions={actions}
                onAction={(action) => dispatchItemAction(action, item)}
              />
            );
          }
          // Fallback: generic event row with per-row clear "✕".
          // For non-subtask events only clearInboxItem surfaces
          // (the four subtask ops have `appliesTo.kind` gates).
          return (
            <GenericInboxRow
              event={item}
              actions={actions}
              onAction={(action) => dispatchItemAction(action, item)}
              onOpen={() => {
                const taskId = item?.taskId ?? item?.parentTaskId;
                if (taskId) nav.navigate(ROUTES.TaskDetail, { id: taskId });
              }}
            />
          );
        }}
      />

      {/* Approve confirm */}
      <Modal transparent visible={!!pendingApprove} animationType="fade"
             onRequestClose={() => setPendingApprove(null)}>
        <View style={{
          flex: 1, backgroundColor: COLORS.overlay,
          alignItems: 'center', justifyContent: 'center', padding: SPACING.lg,
        }}>
          <View style={{
            width: '100%', maxWidth: 420,
            backgroundColor: COLORS.surface,
            borderRadius: RADII.md, padding: SPACING.xl,
          }}>
            <Text style={{ fontSize: FONT_SIZES.lg, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm }}>
              {t('mobile.inbox.subtask_proposal_approve')}
            </Text>
            <Text style={{ color: COLORS.warning, fontSize: FONT_SIZES.sm, marginBottom: SPACING.lg }}>
              {t('mobile.inbox.subtask_proposal_warning')}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Pressable onPress={() => setPendingApprove(null)}
                         style={_btnSecondary(COLORS, SPACING, RADII)}>
                <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md }}>
                  {t('mobile.common.cancel')}
                </Text>
              </Pressable>
              <Pressable onPress={onApprove}
                         style={_btnPrimary(COLORS, SPACING, RADII)}>
                <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' }}>
                  {t('mobile.inbox.subtask_proposal_approve')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Decline confirm + optional note */}
      <Modal transparent visible={!!pendingDecline} animationType="fade"
             onRequestClose={() => { setPendingDecline(null); setDeclineNote(''); }}>
        <View style={{
          flex: 1, backgroundColor: COLORS.overlay,
          alignItems: 'center', justifyContent: 'center', padding: SPACING.lg,
        }}>
          <View style={{
            width: '100%', maxWidth: 420,
            backgroundColor: COLORS.surface,
            borderRadius: RADII.md, padding: SPACING.xl,
          }}>
            <Text style={{ fontSize: FONT_SIZES.lg, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm }}>
              {t('mobile.inbox.subtask_proposal_decline')}
            </Text>
            <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.text, marginBottom: SPACING.sm }}>
              {t('mobile.inbox.decline_note')}
            </Text>
            <TextInput
              value={declineNote}
              onChangeText={setDeclineNote}
              multiline
              autoFocus
              accessibilityLabel="decline-note-input"
              style={{
                minHeight: 80,
                borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
                padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
                backgroundColor: COLORS.surface, textAlignVertical: 'top',
              }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACING.lg }}>
              <Pressable
                onPress={() => { setPendingDecline(null); setDeclineNote(''); }}
                style={_btnSecondary(COLORS, SPACING, RADII)}
              >
                <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md }}>
                  {t('mobile.common.cancel')}
                </Text>
              </Pressable>
              <Pressable onPress={onDecline}
                         style={[_btnPrimary(COLORS, SPACING, RADII), { backgroundColor: COLORS.danger }]}>
                <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' }}>
                  {t('mobile.inbox.subtask_proposal_decline')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 41.18.2 — Clear-all destructive confirm */}
      <ConfirmModal
        visible={showClearAll}
        title={t('mobile.inbox.clear_all_confirm_title')}
        body={t('mobile.inbox.clear_all_confirm_body')}
        confirmLabel={t('mobile.inbox.clear_all')}
        destructive
        onConfirm={onClearAll}
        onCancel={() => setShowClearAll(false)}
      />
    </View>
  );
}

/**
 * Slice C.4 — subtask-proposal card.  Substrate-driven buttons:
 * `actions[]` from `renderItemActions` carries only the ops the
 * manifest's per-kind appliesTo gate matched (approveSubtaskProposal
 * + declineSubtaskProposal for proposals).  The card decides chrome
 * (label / colour); the substrate decides existence.
 */
function SubtaskProposalCard({ event, actions, onAction }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const { t } = useLocalisation();
  const by   = _suffix(event?.by ?? event?.from ?? event?.proposer ?? '');
  const text = event?.partial?.text ?? event?.text ?? '';
  return (
    <View style={{
      padding: SPACING.md,
      borderRadius: RADII.sm,
      backgroundColor: COLORS.surface,
      borderWidth: 1, borderColor: COLORS.border,
      marginBottom: SPACING.sm,
    }}>
      <Text
        numberOfLines={3}
        style={{ color: COLORS.text, fontSize: FONT_SIZES.sm, marginBottom: SPACING.sm }}
      >
        {t('mobile.inbox.subtask_proposal_label', null)
          .replace('{by}', by)
          .replace('{text}', text)}
      </Text>
      <View style={{ flexDirection: 'row' }}>
        {actions.map((action) => {
          const isPrimary = action.opId === 'approveSubtaskProposal';
          const a11yLabel =
            action.opId === 'approveSubtaskProposal' ? 'inbox-approve-proposal'
          : action.opId === 'declineSubtaskProposal' ? 'inbox-decline-proposal'
          : `inbox-${action.opId}`;
          const label =
            action.opId === 'approveSubtaskProposal' ? t('mobile.inbox.subtask_proposal_approve')
          : action.opId === 'declineSubtaskProposal' ? t('mobile.inbox.subtask_proposal_decline')
          : action.label;
          return (
            <Pressable
              key={action.opId}
              onPress={() => onAction(action)}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel}
              style={isPrimary ? {
                paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                borderRadius: RADII.pill, marginRight: SPACING.sm,
                backgroundColor: COLORS.primary,
              } : {
                paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                borderRadius: RADII.pill, marginRight: SPACING.sm,
                borderWidth: 1, borderColor: COLORS.border,
                backgroundColor: COLORS.surface,
              }}
            >
              <Text style={isPrimary ? {
                color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '600',
              } : {
                color: COLORS.text, fontSize: FONT_SIZES.sm,
              }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Slice C.4 — subtask-request card.  Mirror of SubtaskProposalCard
 * for the request kind (approveSubtaskRequest + declineSubtaskRequest
 * via the manifest's per-kind appliesTo gate).
 */
function SubtaskRequestCard({ event, actions, onAction }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const { t } = useLocalisation();
  const by   = _suffix(event?.by ?? event?.from ?? event?.requestedBy ?? '');
  const text = event?.partial?.text ?? event?.text ?? '';
  return (
    <View style={{
      padding: SPACING.md,
      borderRadius: RADII.sm,
      backgroundColor: COLORS.surface,
      borderWidth: 1, borderColor: COLORS.border,
      marginBottom: SPACING.sm,
    }}>
      <Text
        numberOfLines={3}
        style={{ color: COLORS.text, fontSize: FONT_SIZES.sm, marginBottom: SPACING.sm }}
      >
        {t('mobile.inbox.subtask_request_label', null)
          .replace('{by}', by)
          .replace('{text}', text)}
      </Text>
      <View style={{ flexDirection: 'row' }}>
        {actions.map((action) => {
          const isPrimary = action.opId === 'approveSubtaskRequest';
          const a11yLabel =
            action.opId === 'approveSubtaskRequest' ? 'inbox-approve-request'
          : action.opId === 'declineSubtaskRequest' ? 'inbox-decline-request'
          : `inbox-${action.opId}`;
          const label =
            action.opId === 'approveSubtaskRequest' ? t('mobile.inbox.subtask_request_approve')
          : action.opId === 'declineSubtaskRequest' ? t('mobile.inbox.subtask_request_decline')
          : action.label;
          return (
            <Pressable
              key={action.opId}
              onPress={() => onAction(action)}
              accessibilityRole="button"
              accessibilityLabel={a11yLabel}
              style={isPrimary ? {
                paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                borderRadius: RADII.pill, marginRight: SPACING.sm,
                backgroundColor: COLORS.primary,
              } : {
                paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                borderRadius: RADII.pill, marginRight: SPACING.sm,
                borderWidth: 1, borderColor: COLORS.border,
                backgroundColor: COLORS.surface,
              }}
            >
              <Text style={isPrimary ? {
                color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '600',
              } : {
                color: COLORS.text, fontSize: FONT_SIZES.sm,
              }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Slice C.4 — generic-event row (non-subtask kinds).  Surfaces a
 * tap-to-open zone (when the event references a task) + the
 * `clearInboxItem` "✕" button.  Pre-C.4 the "✕" was hand-rolled;
 * now it's surfaced via the substrate-projected actions[] (the only
 * action that matches kinds without a `kind` gate on appliesTo).
 */
function GenericInboxRow({ event, actions, onAction, onOpen }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const { t } = useLocalisation();
  const kind = kindOf(event);

  // The substrate-projected per-row actions on a generic event are
  // just `clearInboxItem` (its appliesTo has no `kind` gate).  Pick it
  // out explicitly so the dismiss "✕" stays the right-side action.
  const dismiss = actions.find((a) => a.opId === 'clearInboxItem');

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'stretch',
      marginBottom: SPACING.sm,
    }}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        style={{
          flex: 1,
          padding: SPACING.md,
          borderTopLeftRadius: RADII.sm,
          borderBottomLeftRadius: RADII.sm,
          backgroundColor: COLORS.surface,
          borderWidth: 1, borderColor: COLORS.border,
          borderRightWidth: dismiss ? 0 : 1,
        }}
      >
        <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
          {t('mobile.inbox.generic_label', null).replace('{kind}', kind)}
        </Text>
        {event?.text ? (
          <Text numberOfLines={2}
                style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 4 }}>
            {event.text}
          </Text>
        ) : null}
      </Pressable>
      {dismiss ? (
        <Pressable
          onPress={() => onAction(dismiss)}
          accessibilityRole="button"
          accessibilityLabel="inbox-clear-item"
          style={{
            width: 44, justifyContent: 'center', alignItems: 'center',
            borderTopRightRadius: RADII.sm,
            borderBottomRightRadius: RADII.sm,
            backgroundColor: COLORS.surface,
            borderWidth: 1, borderColor: COLORS.border,
          }}
        >
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.lg }}>
            ✕
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function _btnSecondary(COLORS, SPACING, RADII) {
  return {
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
    borderRadius: RADII.sm, marginLeft: SPACING.sm,
    backgroundColor: COLORS.surfaceMuted,
  };
}
function _btnPrimary(COLORS, SPACING, RADII) {
  return {
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
    borderRadius: RADII.sm, marginLeft: SPACING.sm,
    backgroundColor: COLORS.primary,
  };
}

function _suffix(webid) {
  if (typeof webid !== 'string') return '?';
  const i = webid.lastIndexOf('/');
  return i >= 0 ? webid.slice(i + 1) : webid;
}

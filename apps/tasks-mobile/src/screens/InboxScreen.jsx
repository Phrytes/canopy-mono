/**
 * InboxScreen — list of inbox events for the active actor.
 *
 * Phase 41.6.4 (2026-05-09).
 *
 * Wires `listMyInbox` via useSkillResult. Each event renders per-kind:
 *   - 'subtask-proposal' → [Approve] / [Decline] buttons calling
 *     approveSubtaskProposal / declineSubtaskProposal. Approve
 *     warns about the parent rollback.
 *   - other kinds: generic label + tap-to-open if it carries a taskId.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Modal, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme }       from '@canopy/react-native/theme';
import { useService }     from '../ServiceContext.js';
import { useSkill, useSkillResult } from '../lib/useSkill.js';
import { useI18n }        from '../I18nProvider.js';
import { kindOf, proposalIdOf } from '../lib/inboxClassify.js';
import { ROUTES }         from '../navigation.js';

export function InboxScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const list = useSkillResult('listMyInbox', {}, [svc?.activeCrewId]);
  const approveProposal = useSkill('approveSubtaskProposal');
  const declineProposal = useSkill('declineSubtaskProposal');

  const items = Array.isArray(list?.data?.items) ? list.data.items
              : Array.isArray(list?.data?.events) ? list.data.events
              : [];

  const [pendingApprove, setPendingApprove] = useState(null); // event being confirmed
  const [pendingDecline, setPendingDecline] = useState(null);
  const [declineNote, setDeclineNote] = useState('');

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

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
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
          const kind = kindOf(item);
          if (kind === 'subtask-proposal') {
            return (
              <SubtaskProposalCard
                event={item}
                onApprove={() => setPendingApprove(item)}
                onDecline={() => setPendingDecline(item)}
              />
            );
          }
          // Fallback: generic event row.
          return (
            <Pressable
              onPress={() => {
                const taskId = item?.taskId ?? item?.parentTaskId;
                if (taskId) nav.navigate(ROUTES.TaskDetail, { id: taskId });
              }}
              accessibilityRole="button"
              style={{
                padding: SPACING.md,
                borderRadius: RADII.sm,
                backgroundColor: COLORS.surface,
                borderWidth: 1, borderColor: COLORS.border,
                marginBottom: SPACING.sm,
              }}
            >
              <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
                {t('mobile.inbox.generic_label', null).replace('{kind}', kind)}
              </Text>
              {item?.text ? (
                <Text numberOfLines={2}
                      style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 4 }}>
                  {item.text}
                </Text>
              ) : null}
            </Pressable>
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
    </View>
  );
}

function SubtaskProposalCard({ event, onApprove, onDecline }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const { t } = useI18n();
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
        <Pressable
          onPress={onApprove}
          accessibilityRole="button"
          accessibilityLabel="inbox-approve-proposal"
          style={{
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
            borderRadius: RADII.pill, marginRight: SPACING.sm,
            backgroundColor: COLORS.primary,
          }}
        >
          <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '600' }}>
            {t('mobile.inbox.subtask_proposal_approve')}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDecline}
          accessibilityRole="button"
          accessibilityLabel="inbox-decline-proposal"
          style={{
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
            borderRadius: RADII.pill, borderWidth: 1, borderColor: COLORS.border,
            backgroundColor: COLORS.surface,
          }}
        >
          <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
            {t('mobile.inbox.subtask_proposal_decline')}
          </Text>
        </Pressable>
      </View>
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

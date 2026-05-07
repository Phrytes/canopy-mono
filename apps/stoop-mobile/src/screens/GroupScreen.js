/**
 * GroupScreen — group / governance view.
 *
 * Stoop V3 mobile.  Phase 40.18 (2026-05-08): wired to live agent.
 * Reads:
 *   - getCurrentMembershipCode(groupId)  — admin code visibility
 *   - rotateMyGroupCode(groupId)         — admin only
 *   - leaveGroup({groupId})              — destructive
 *   - issueInvite({...})                 — admin generates QR
 */

import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/i18n.js';
import { ConfirmModal }                      from '../components/ConfirmModal.js';
import { useService }                        from '../ServiceContext.js';
import { useSkill }                          from '../lib/useSkill.js';
import { useSkillResult }                    from '../lib/useSkillResult.js';

export function GroupScreen() {
  const nav = useNavigation();
  const svc = useService();

  const activeEntry = svc?.activeEntry ?? null;
  const groupId = activeEntry?.groupId ?? null;

  const code = useSkillResult('getCurrentMembershipCode',
    groupId ? { groupId } : null, [groupId]);
  const rotate = useSkill('rotateMyGroupCode');
  const leave  = useSkill('leaveGroup');
  const issue  = useSkill('issueInvite');

  const [showLeave, setShowLeave] = useState(false);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);

  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('group.no_active_group',
             'Sluit eerst aan bij een groep om de groep-info te zien.')}
        </Text>
      </View>
    );
  }

  // Membership snapshot from MemberMap.
  const members = svc.activeBundle.members;
  const memberList = members?.list?.() ?? [];
  const selfAddr   = svc.activeBundle.agent.address ?? svc.activeBundle.agent.identity?.pubKey;
  const me = (typeof members?.resolveByPubKey === 'function')
    ? members.resolveByPubKey(selfAddr)
    : null;
  const isAdmin    = me?.role === 'admin' || me?.role === 'coordinator';
  const evicted    = !!activeEntry?.evicted;

  const onIssueInvite = async () => {
    setBusy(true); setError(null);
    try {
      const r = await issue.call({});
      if (r?.invite) nav.navigate(ROUTES.OnboardIssue, { invite: r.invite });
    } catch (err) { setError(err?.message ?? String(err)); }
    finally { setBusy(false); }
  };

  const onRotate = async () => {
    setBusy(true); setError(null);
    try {
      await rotate.call({ groupId });
      await code.refresh();
    } catch (err) { setError(err?.message ?? String(err)); }
    finally { setBusy(false); }
  };

  const onLeave = async () => {
    setShowLeave(false);
    setBusy(true); setError(null);
    try {
      await leave.call({ groupId });
      await svc.removeGroup(groupId);
      nav.navigate(ROUTES.Welcome);
    } catch (err) { setError(err?.message ?? String(err)); }
    finally { setBusy(false); }
  };

  const codeData    = code.data ?? {};
  const expiresAt   = codeData.expiresAt;
  const rotationDays= codeData.rotationDays;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>
        {activeEntry?.displayName ?? groupId ?? t('group.unnamed', 'Onbekende groep')}
      </Text>

      {evicted ? (
        <View style={styles.evictionBanner}>
          <Text style={styles.evictionTitle}>
            {t('group.evicted_title', 'Je bent uit deze groep verwijderd.')}
          </Text>
          <Text style={styles.evictionBody}>
            {t('group.evicted_body',
               'Je kan posts en berichten in deze groep niet meer zien. Vraag de admin opnieuw uitgenodigd te worden.')}
          </Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.label}>{t('group.member_count', 'Aantal leden')}</Text>
        <Text style={styles.value}>{memberList.length}</Text>
      </View>

      {isAdmin && codeData.code ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('group.admin_code', 'Admin-code')}</Text>
          <Text style={[styles.value, styles.mono]} selectable>{codeData.code}</Text>
          <Text style={styles.hint}>
            {t('group.admin_code_hint',
               'Deel deze code alleen met andere admins.')}
          </Text>
          {expiresAt ? (
            <Text style={styles.hint}>
              {t('group.admin_code_expires', 'Verloopt op {ts} ({n} dagen)')
                .replace('{ts}', new Date(expiresAt).toLocaleDateString())
                .replace('{n}', String(rotationDays ?? 30))}
            </Text>
          ) : null}
          <Pressable
            onPress={onRotate}
            disabled={busy}
            style={styles.btnSecondary}
            accessibilityRole="button"
            accessibilityLabel="group-rotate-code"
          >
            <Text style={styles.btnSecondaryLabel}>
              {busy ? t('group.rotating', 'Roteren…')
                    : t('group.rotate_code', 'Roteer code nu')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {isAdmin ? (
        <Pressable
          onPress={onIssueInvite}
          disabled={busy}
          style={styles.btnPrimary}
          accessibilityRole="button"
          accessibilityLabel="group-issue-invite"
        >
          <Text style={styles.btnPrimaryLabel}>
            {busy
              ? t('group.issuing', 'Maken…')
              : t('group.issue_invite', 'Maak uitnodiging')}
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={() => setShowLeave(true)}
        style={styles.btnDanger}
        accessibilityRole="button"
        accessibilityLabel="group-leave"
      >
        <Text style={styles.btnDangerLabel}>
          {t('group.leave', 'Verlaat groep')}
        </Text>
      </Pressable>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {code.loading ? <ActivityIndicator /> : null}

      <ConfirmModal
        visible={showLeave}
        destructive
        title={t('group.confirm_leave_title', 'Verlaat deze groep?')}
        body={t('group.confirm_leave_body',
                'Je verliest de toegang tot alle posts en berichten in deze groep.')}
        confirmLabel={t('group.confirm_leave_yes', 'Verlaat')}
        cancelLabel={t('contact.confirm_no', 'Annuleer')}
        onConfirm={onLeave}
        onCancel={() => setShowLeave(false)}
      />
    </ScrollView>
  );
}

export default GroupScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZES.md, textAlign: 'center' },
  evictionBanner: {
    backgroundColor: '#ffebee', borderColor: COLORS.danger, borderWidth: 1,
    borderRadius: RADII.md, padding: SPACING.lg, marginBottom: SPACING.lg,
  },
  evictionTitle: { color: COLORS.danger, fontSize: FONT_SIZES.md, fontWeight: '600', marginBottom: SPACING.xs },
  evictionBody:  { color: COLORS.text, fontSize: FONT_SIZES.sm, lineHeight: 20 },
  section: {
    marginBottom: SPACING.md, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  label: { fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.xs },
  value: { fontSize: FONT_SIZES.md, color: COLORS.text, fontWeight: '500' },
  mono:  { fontFamily: 'monospace', fontSize: FONT_SIZES.sm },
  hint:  { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: SPACING.xs },
  btnPrimary: {
    backgroundColor: COLORS.primary, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center', marginTop: SPACING.md,
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted, paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg, borderRadius: RADII.sm,
    alignItems: 'center', marginTop: SPACING.md,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  btnDanger: {
    backgroundColor: COLORS.danger, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center', marginTop: SPACING.lg,
  },
  btnDangerLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },
});

/**
 * GroupScreen — group / governance view.
 *
 * Stoop V3 mobile.  Shows:
 *   - Group display name + member count.
 *   - Admin code (admin-only).
 *   - "Issue invite" CTA → OnboardIssueScreen with the freshly-issued
 *     invite token (admin only).
 *   - Eviction-banner state (when the user has been evicted).
 *   - "Leave group" destructive action.
 */

import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/i18n.js';
import { ConfirmModal }                      from '../components/ConfirmModal.js';

/**
 * @param {object} props
 * @param {object} [props.group]  `{id, name, memberCount, isAdmin, adminCode, evicted}`
 * @param {() => Promise<object>} [props.onIssueInvite]   returns invite token
 * @param {() => Promise<void>}   [props.onLeaveGroup]
 */
export function GroupScreen({ group = {}, onIssueInvite, onLeaveGroup } = {}) {
  const nav = useNavigation();
  const [showLeave, setShowLeave] = useState(false);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState(null);

  const issue = async () => {
    setBusy(true); setError(null);
    try {
      const tok = onIssueInvite ? await onIssueInvite() : null;
      if (tok) nav.navigate(ROUTES.OnboardIssue, { invite: tok });
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setShowLeave(false);
    setBusy(true); setError(null);
    try {
      if (onLeaveGroup) await onLeaveGroup();
      nav.navigate(ROUTES.Welcome);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>
        {group.name ?? t('group.unnamed', 'Onbekende groep')}
      </Text>

      {group.evicted ? (
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
        <Text style={styles.value}>{group.memberCount ?? '—'}</Text>
      </View>

      {group.isAdmin && group.adminCode ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('group.admin_code', 'Admin-code')}</Text>
          <Text style={[styles.value, styles.mono]} selectable>
            {group.adminCode}
          </Text>
          <Text style={styles.hint}>
            {t('group.admin_code_hint',
               'Deel deze code alleen met andere admins.')}
          </Text>
        </View>
      ) : null}

      {group.isAdmin ? (
        <Pressable
          onPress={issue}
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

      <ConfirmModal
        visible={showLeave}
        destructive
        title={t('group.confirm_leave_title', 'Verlaat deze groep?')}
        body={t('group.confirm_leave_body',
                'Je verliest de toegang tot alle posts en berichten in deze groep.')}
        confirmLabel={t('group.confirm_leave_yes', 'Verlaat')}
        cancelLabel={t('contact.confirm_no', 'Annuleer')}
        onConfirm={leave}
        onCancel={() => setShowLeave(false)}
      />
    </ScrollView>
  );
}

export default GroupScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
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
  btnDanger: {
    backgroundColor: COLORS.danger, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center', marginTop: SPACING.lg,
  },
  btnDangerLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },
});

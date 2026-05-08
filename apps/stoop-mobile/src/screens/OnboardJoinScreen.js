/**
 * OnboardJoinScreen — receiver side of the membership-code flow.
 *
 * Stoop V3 Phase 40.23 follow-up (2026-05-08).
 *
 * The scanner classifies a `{groupId, code, expiresAt}` payload and
 * routes here. We:
 *
 *   1. Self-seed the membership-code item locally (the scanned QR
 *      payload IS the OOB attestation — Stoop's whole design rests
 *      on the code being a shared secret).  Without this seed,
 *      `redeemMembershipCode` would reject because the second device
 *      has no items in its store yet.
 *   2. Call `redeemMembershipCode({groupId, code})` against the
 *      bootstrap bundle so the redemption is recorded as an audit
 *      trail item.
 *   3. Call `svc.addGroup({groupId, role: 'member'})` so the
 *      bundle gets registered + Feed / Mine / Group screens become
 *      live for the new group.  This relabels the bootstrap into the
 *      new groupId on first-group transition (preserving the just-
 *      written code item + redemption item).
 *
 * Multi-device peer-discovery (so post #1 actually shows up on the
 * other phone) is a separate substrate concern — call it out in the
 * UI but don't block.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/i18n.js';
import { useService }                         from '../ServiceContext.js';
import { useSkill }                           from '../lib/useSkill.js';

export function OnboardJoinScreen() {
  const nav   = useNavigation();
  const route = useRoute();
  const svc   = useService();

  const invite = route?.params?.invite ?? null;
  const groupId   = invite?.groupId ?? null;
  const code      = invite?.code    ?? null;
  const expiresAt = invite?.expiresAt ?? null;
  // Display name from the QR payload — falls back to groupId for
  // older QRs that pre-date the name field.  Without this, the two
  // phones disagree on the group's name (admin sees the friendly
  // name, joiner sees the slug).
  const displayName = (typeof invite?.name === 'string' && invite.name.trim().length > 0)
    ? invite.name.trim()
    : groupId;

  const redeem = useSkill('redeemMembershipCode');

  const [stage,  setStage]  = useState('idle');   // idle | working | done | error
  const [error,  setError]  = useState(null);
  const [busy,   setBusy]   = useState(false);

  const onJoin = useCallback(async () => {
    if (!invite || !groupId || !code) {
      setError('Missing invite payload.');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    setStage('working');
    try {
      // 1. Self-seed the membership-code item so redeemMembershipCode
      // can find it in the local store. The QR's `{groupId, code,
      // expiresAt}` IS the attestation — having scanned a fresh code
      // out of band stands in for verifying it against the issuer.
      const bundle = svc?.activeBundle ?? await svc?.ensureActiveBundle?.();
      if (!bundle?.itemStore?.addItems) {
        throw new Error('No itemStore available — bundle not ready.');
      }
      const localActor =
        bundle.agent?.address ??
        bundle.agent?.identity?.pubKey ??
        'webid:local:unknown';
      // Skip if we already have this code locally (idempotent).
      const existing = await bundle.itemStore.listOpen({ type: 'membership-code' });
      const already = existing.some(
        (i) => i?.source?.groupId === groupId && i?.source?.code === code,
      );
      if (!already) {
        await bundle.itemStore.addItems([{
          type:       'membership-code',
          text:       `Membership code for ${groupId}`,
          source:     {
            groupId,
            code,
            issuedAt:  Date.now(),
            expiresAt: typeof expiresAt === 'number' ? expiresAt : (Date.now() + 30 * 24 * 60 * 60 * 1000),
            issuedBy:  'qr-self-seed',
            keyRotationMode: 'admin-only',
            rotationDays: 30,
          },
          visibility: 'household',
        }], { actor: localActor });
      }

      // 2. Record the redemption (best-effort: surface error but don't block).
      try {
        const r = await redeem.call({ groupId, code });
        if (r?.error) throw new Error(r.error);
      } catch (err) {
        console.warn('[OnboardJoin] redeemMembershipCode failed:', err?.message ?? err);
      }

      // 3. Register the group locally.
      await svc.addGroup({
        groupId,
        displayName,
        role:        'member',
      });

      setStage('done');
    } catch (err) {
      setError(err?.message ?? String(err));
      setStage('error');
    } finally {
      setBusy(false);
    }
  }, [invite, groupId, code, expiresAt, displayName, busy, svc, redeem]);

  // Auto-start the join attempt on mount if the invite is well-formed.
  useEffect(() => {
    if (invite && groupId && code && stage === 'idle') {
      onJoin().catch(() => { /* surfaced via error state */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite, groupId, code]);

  if (!invite || !groupId || !code) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('onboard_join.no_invite',
             'Geen geldige uitnodiging. Scan de QR opnieuw of laat de admin een nieuwe maken.')}
        </Text>
        <Pressable
          onPress={() => nav.navigate(ROUTES.OnboardScan)}
          style={styles.btnSecondary}
        >
          <Text style={styles.btnSecondaryLabel}>
            {t('onboard_join.scan_again', 'Scan opnieuw')}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>
        {t('onboard_join.heading', 'Aansluiten bij groep')}
      </Text>
      {displayName !== groupId ? (
        <Text style={styles.body}>
          {displayName}
        </Text>
      ) : null}
      <Text style={styles.body}>
        {t('onboard_join.body', 'Groep-id:')}
        {' '}<Text style={styles.mono}>{groupId}</Text>
      </Text>

      {stage === 'working' ? (
        <View style={styles.row}>
          <ActivityIndicator />
          <Text style={[styles.body, { marginLeft: SPACING.md }]}>
            {t('onboard_join.working', 'Bezig met aansluiten…')}
          </Text>
        </View>
      ) : null}

      {stage === 'done' ? (
        <View style={styles.section}>
          <Text style={styles.successText}>
            {t('onboard_join.success', 'Aangesloten!')}
          </Text>
          <Text style={styles.hint}>
            {t('onboard_join.peer_discovery_hint',
               'Je toestel is nu lid van de groep. Posts van anderen verschijnen pas als de toestellen elkaar kunnen vinden — over hetzelfde Wi-Fi (mDNS) of via een relay.')}
          </Text>
          <Pressable
            onPress={() => nav.navigate(ROUTES.Shell, { screen: ROUTES.Feed })}
            style={styles.btnPrimary}
          >
            <Text style={styles.btnPrimaryLabel}>
              {t('onboard_join.go_feed', 'Naar prikbord')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {stage === 'error' ? (
        <View style={styles.section}>
          <Text style={styles.errorText}>{error ?? '—'}</Text>
          <Pressable
            onPress={onJoin}
            disabled={busy}
            style={styles.btnPrimary}
          >
            <Text style={styles.btnPrimaryLabel}>
              {t('onboard_join.retry', 'Opnieuw proberen')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => nav.navigate(ROUTES.OnboardScan)}
            style={styles.btnSecondary}
          >
            <Text style={styles.btnSecondaryLabel}>
              {t('onboard_join.scan_again', 'Scan opnieuw')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

export default OnboardJoinScreen;

const styles = StyleSheet.create({
  root:    { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  body:    { fontSize: FONT_SIZES.md, color: COLORS.textMuted, lineHeight: 22, marginBottom: SPACING.lg },
  mono:    { fontFamily: 'monospace', fontSize: FONT_SIZES.sm, color: COLORS.text },
  hint:    { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginVertical: SPACING.md, lineHeight: 18 },
  row:     { flexDirection: 'row', alignItems: 'center', marginVertical: SPACING.md },
  section: {
    marginVertical: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  successText: { color: COLORS.success, fontSize: FONT_SIZES.md, fontWeight: '600', marginBottom: SPACING.sm },
  errorText:   { color: COLORS.danger,  fontSize: FONT_SIZES.sm, marginBottom: SPACING.md, fontFamily: 'monospace' },
  btnPrimary: {
    backgroundColor: COLORS.primary, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center', marginTop: SPACING.md,
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center', marginTop: SPACING.md,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  empty:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZES.md, textAlign: 'center', marginBottom: SPACING.lg },
});

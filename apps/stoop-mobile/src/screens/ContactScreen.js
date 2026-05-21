/**
 * ContactScreen — single contact detail.
 *
 * Stoop V3 mobile.  Phase 40.18 (2026-05-08): wired to live agent.
 * Trust picker (bekend / vertrouwd) + per-contact flags
 * (shareLocation / hopThrough / autoMatch) + Share-my-QR
 * (`getContactShareQr`) + mute / unmute (mutePeer / unmutePeer).
 */

import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/localisation.js';
import { AvatarCircle }                      from '../components/AvatarCircle.js';
import { ConfirmModal }                      from '../components/ConfirmModal.js';
import { QrCode }                            from '../components/QrCode.js';
import { useService }                        from '../ServiceContext.js';
import { useSkill }                          from '../lib/useSkill.js';
import { useSkillResult }                    from '../lib/useSkillResult.js';

const TRUST_LEVELS = ['bekend', 'vertrouwd'];
const FLAGS        = ['shareLocation', 'hopThrough', 'autoMatch'];

export function ContactScreen() {
  const nav   = useNavigation();
  const route = useRoute();
  const svc   = useService();

  // Route can pass `contact` (full snapshot) or `contactId`.
  const handFedContact = route?.params?.contact ?? null;
  const contactId      = route?.params?.contactId ?? handFedContact?.id ?? handFedContact?.webid ?? null;

  // Listen on listContacts for live updates after setContactTrust /
  // setContactFlag.  Find the matching entry by id.
  const { data, loading, refresh } = useSkillResult('listContacts', {}, []);
  const contact = handFedContact ?? (data?.contacts ?? []).find(
    (c) => (c.id ?? c.webid) === contactId,
  );

  // Lazy: getContactShareQr — only fetched when user toggles "Show my QR".
  const [showQr, setShowQr] = useState(false);
  const shareQrCall = useSkill('getContactShareQr');
  const [shareQrPayload, setShareQrPayload] = useState(null);
  const onToggleQr = async () => {
    if (showQr) { setShowQr(false); return; }
    if (!shareQrPayload) {
      try {
        const r = await shareQrCall.call({});
        setShareQrPayload(r?.payload ?? r?.uri ?? null);
      } catch { /* swallow */ }
    }
    setShowQr(true);
  };

  const setTrust = useSkill('setContactTrust');
  const setFlag  = useSkill('setContactFlag');
  const mute     = useSkill('mutePeer');
  const unmute   = useSkill('unmutePeer');
  const remove   = useSkill('removeContact');

  const [confirm, setConfirm] = useState(null);
  const [error, setError]     = useState(null);

  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('contact.no_active_group', 'Sluit eerst aan bij een groep.')}
        </Text>
      </View>
    );
  }
  if (loading && !contact) {
    return <View style={styles.empty}><ActivityIndicator /></View>;
  }
  if (!contact) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('contact.unknown', 'Contact niet gevonden.')}</Text>
      </View>
    );
  }

  const peerKey = contact.stableId ?? contact.id ?? contact.webid ?? null;
  const name = (contact.revealed && contact.displayName) ? contact.displayName : `@${contact.handle ?? '?'}`;

  const onSetTrust = async (next) => {
    try {
      await setTrust.call({ contactId: peerKey, webid: contact.webid, trust: next });
      await refresh();
    } catch (err) { setError(err?.message ?? String(err)); }
  };
  const onToggleFlag = async (flag) => {
    const next = !contact.flags?.[flag];
    try {
      await setFlag.call({ contactId: peerKey, webid: contact.webid, flag, on: next });
      await refresh();
    } catch (err) { setError(err?.message ?? String(err)); }
  };

  const runConfirm = (action) => async () => {
    setConfirm(null);
    try { await action(); await refresh(); }
    catch (err) { setError(err?.message ?? String(err)); }
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <View style={styles.hero}>
        <AvatarCircle uri={contact.avatarUrl ?? contact.avatarUri} name={name} size={96} />
        <Text style={styles.name}>{name}</Text>
        {contact.revealed && contact.displayName ? (
          <Text style={styles.subhandle}>@{contact.handle ?? '?'}</Text>
        ) : null}
        {contact.muted ? <Text style={styles.tag}>{t('contacts.muted', 'gedempt')}</Text> : null}
      </View>

      {/* Trust picker */}
      <View style={styles.section}>
        <Text style={styles.label}>{t('contact.trust_label', 'Vertrouwen')}</Text>
        <View style={styles.row}>
          {TRUST_LEVELS.map((trust) => {
            const active = contact.trust === trust;
            return (
              <Pressable
                key={trust}
                onPress={() => onSetTrust(trust)}
                style={[styles.chip, active && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {trust === 'vertrouwd'
                    ? t('contacts.trust_vertrouwd', 'trusted')
                    : t('contacts.trust_bekend', 'acquainted')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Per-contact flags */}
      <View style={styles.section}>
        <Text style={styles.label}>{t('contact.flags_label', 'Per-contact opties')}</Text>
        {FLAGS.map((flag) => (
          <View key={flag} style={styles.flagRow}>
            <Text style={[styles.flagLabel, { flex: 1 }]}>
              {t(`contacts.flag_${flag === 'shareLocation' ? 'share_location'
                  : flag === 'hopThrough' ? 'hop_through'
                  : 'auto_match'}`, flag)}
            </Text>
            <Pressable
              onPress={() => onToggleFlag(flag)}
              style={[styles.toggle, contact.flags?.[flag] && styles.toggleActive]}
              accessibilityRole="switch"
              accessibilityState={{ checked: !!contact.flags?.[flag] }}
            >
              <Text style={styles.toggleLabel}>
                {contact.flags?.[flag]
                  ? t('contacts.flag_on',  'aan')
                  : t('contacts.flag_off', 'uit')}
              </Text>
            </Pressable>
          </View>
        ))}
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <Pressable
          onPress={() => nav.navigate(ROUTES.ChatThread, { peerId: peerKey })}
          style={styles.btnPrimary}
          accessibilityRole="button"
          accessibilityLabel="contact-open-chat"
        >
          <Text style={styles.btnPrimaryLabel}>
            {t('contact.open_chat', 'Open gesprek')}
          </Text>
        </Pressable>
        <Pressable
          onPress={onToggleQr}
          style={styles.btnSecondary}
          accessibilityRole="button"
          accessibilityLabel="contact-show-qr"
        >
          <Text style={styles.btnSecondaryLabel}>
            {showQr
              ? t('contact.hide_qr', 'Verberg QR')
              : t('contact.show_qr', 'Toon mijn QR')}
          </Text>
        </Pressable>
        {showQr && shareQrPayload ? (
          <View style={styles.qrFrame}>
            <QrCode value={shareQrPayload} size={220} />
            <Text style={styles.qrCaption}>
              {t('contact.qr_caption',
                 'Laat dit zien aan je contact om elkaar als bekend te markeren.')}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Mute / remove */}
      <View style={styles.section}>
        {contact.muted ? (
          <Pressable
            onPress={() => setConfirm({ kind: 'unmute' })}
            style={styles.btnSecondary}
          >
            <Text style={styles.btnSecondaryLabel}>{t('contact.unmute', 'Demp opheffen')}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setConfirm({ kind: 'mute' })}
            style={styles.btnSecondary}
          >
            <Text style={styles.btnSecondaryLabel}>{t('contact.mute', 'Demp')}</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => setConfirm({ kind: 'remove' })}
          style={styles.btnDanger}
        >
          <Text style={styles.btnDangerLabel}>{t('contact.remove', 'Verwijder')}</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <ConfirmModal
        visible={!!confirm}
        destructive={confirm?.kind === 'remove'}
        title={
          confirm?.kind === 'mute'    ? t('contact.confirm_mute_title',  'Contact dempen?')
        : confirm?.kind === 'unmute'  ? t('contact.confirm_unmute_title', 'Demp opheffen?')
        : confirm?.kind === 'remove'  ? t('contact.confirm_remove_title', 'Contact verwijderen?')
        : ''}
        body={
          confirm?.kind === 'mute'    ? t('contact.confirm_mute_body',   'Je krijgt geen meldingen meer van dit contact.')
        : confirm?.kind === 'unmute'  ? t('contact.confirm_unmute_body', 'Meldingen weer aanzetten.')
        : confirm?.kind === 'remove'  ? t('contact.confirm_remove_body', 'Je verwijdert dit contact uit je lijst.')
        : ''}
        confirmLabel={t('contact.confirm_yes', 'Bevestig')}
        cancelLabel={t('contact.confirm_no',  'Annuleer')}
        onConfirm={
          confirm?.kind === 'mute'    ? runConfirm(() => mute.call({ peerStableId: peerKey, peerWebid: contact.webid }))
        : confirm?.kind === 'unmute'  ? runConfirm(() => unmute.call({ peerStableId: peerKey, peerWebid: contact.webid }))
        : confirm?.kind === 'remove'  ? runConfirm(async () => {
            await remove.call({ contactId: peerKey, webid: contact.webid });
            nav.goBack();
          })
        : () => setConfirm(null)
        }
        onCancel={() => setConfirm(null)}
      />
    </ScrollView>
  );
}

export default ContactScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  hero: { alignItems: 'center', marginVertical: SPACING.xl },
  name: { marginTop: SPACING.md, fontSize: FONT_SIZES.lg, fontWeight: '600', color: COLORS.text },
  subhandle: { marginTop: 4, fontSize: FONT_SIZES.sm, color: COLORS.textMuted },
  tag:  { marginTop: 4, fontSize: FONT_SIZES.xs, color: COLORS.warning },
  section: {
    marginBottom: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  label: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm },
  row:   { flexDirection: 'row' },
  chip: {
    paddingVertical: SPACING.sm - 2, paddingHorizontal: SPACING.md,
    borderRadius: RADII.pill, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, marginRight: SPACING.sm,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primaryDark },
  chipLabel:       { color: COLORS.text, fontSize: FONT_SIZES.sm },
  chipLabelActive: { color: COLORS.textInverse, fontWeight: '600' },
  flagRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs },
  flagLabel: { fontSize: FONT_SIZES.sm, color: COLORS.text },
  toggle: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs,
    borderRadius: RADII.pill, backgroundColor: COLORS.surfaceMuted,
  },
  toggleActive: { backgroundColor: COLORS.primary },
  toggleLabel:  { color: COLORS.text, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg, borderRadius: RADII.md,
    alignItems: 'center', marginBottom: SPACING.sm,
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted,
    paddingVertical: SPACING.lg, borderRadius: RADII.md,
    alignItems: 'center', marginBottom: SPACING.sm,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  btnDanger: {
    backgroundColor: COLORS.danger,
    paddingVertical: SPACING.lg, borderRadius: RADII.md,
    alignItems: 'center', marginTop: SPACING.sm,
  },
  btnDangerLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  qrFrame: { alignItems: 'center', marginTop: SPACING.lg },
  qrCaption: {
    marginTop: SPACING.sm, color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs, textAlign: 'center',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZES.md, textAlign: 'center' },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },
});

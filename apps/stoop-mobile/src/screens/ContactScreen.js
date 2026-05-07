/**
 * ContactScreen — single-contact detail.
 *
 * Stoop V3 mobile.  Shows the contact's avatar / handle / displayName
 * (when revealed) plus mute / unmute / block actions, "Open chat,"
 * and "Show my QR" (so the user can mirror-share their identity to
 * this contact).
 */

import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/i18n.js';
import { AvatarCircle }                      from '../components/AvatarCircle.js';
import { ConfirmModal }                      from '../components/ConfirmModal.js';
import { QrCode }                            from '../components/QrCode.js';

/**
 * @param {object} props
 * @param {object} [props.contact]   resolved contact ({id, handle, ...}); falls
 *   back to `route.params.contact`.
 * @param {string} [props.shareQrPayload]   `stoop-contact://...` URI to render in QR.
 * @param {(id: string) => Promise<void>} [props.onMute]
 * @param {(id: string) => Promise<void>} [props.onUnmute]
 * @param {(id: string) => Promise<void>} [props.onBlock]
 */
export function ContactScreen({
  contact: contactProp,
  shareQrPayload,
  onMute, onUnmute, onBlock,
} = {}) {
  const nav   = useNavigation();
  const route = useRoute();
  const contact = contactProp ?? route?.params?.contact;

  const [showQr, setShowQr] = useState(false);
  const [confirm, setConfirm] = useState(null);

  if (!contact) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('contact.unknown', 'Contact niet gevonden.')}
        </Text>
      </View>
    );
  }

  const name = contact.revealed && contact.displayName
    ? contact.displayName
    : `@${contact.handle}`;

  const runConfirm = (action) => async () => {
    setConfirm(null);
    try { await action?.(contact.id); }
    catch { /* swallow — bring-up code surfaces failures elsewhere */ }
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <View style={styles.hero}>
        <AvatarCircle uri={contact.avatarUri} name={name} size={96} />
        <Text style={styles.name}>{name}</Text>
        {contact.revealed && contact.displayName ? (
          <Text style={styles.subhandle}>@{contact.handle}</Text>
        ) : null}
        {contact.muted ? (
          <Text style={styles.tag}>{t('contacts.muted', 'gedempt')}</Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Pressable
          onPress={() => nav.navigate(ROUTES.ChatThread, { peerId: contact.id })}
          style={styles.btnPrimary}
          accessibilityRole="button"
          accessibilityLabel="contact-open-chat"
        >
          <Text style={styles.btnPrimaryLabel}>
            {t('contact.open_chat', 'Open gesprek')}
          </Text>
        </Pressable>
        {shareQrPayload ? (
          <Pressable
            onPress={() => setShowQr((v) => !v)}
            style={styles.btnSecondary}
            accessibilityRole="button"
            accessibilityLabel="contact-show-qr"
          >
            <Text style={styles.btnSecondaryLabel}>
              {showQr
                ? t('contact.hide_qr',  'Verberg QR')
                : t('contact.show_qr',  'Toon mijn QR')}
            </Text>
          </Pressable>
        ) : null}
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
          onPress={() => setConfirm({ kind: 'block' })}
          style={styles.btnDanger}
        >
          <Text style={styles.btnDangerLabel}>{t('contact.block', 'Blokkeer')}</Text>
        </Pressable>
      </View>

      <ConfirmModal
        visible={!!confirm}
        destructive={confirm?.kind === 'block'}
        title={
          confirm?.kind === 'mute'    ? t('contact.confirm_mute_title',  'Contact dempen?')
        : confirm?.kind === 'unmute'  ? t('contact.confirm_unmute_title', 'Demp opheffen?')
        : confirm?.kind === 'block'   ? t('contact.confirm_block_title', 'Contact blokkeren?')
        : ''}
        body={
          confirm?.kind === 'mute'    ? t('contact.confirm_mute_body',  'Je krijgt geen meldingen meer van dit contact.')
        : confirm?.kind === 'unmute'  ? t('contact.confirm_unmute_body','Meldingen weer aanzetten.')
        : confirm?.kind === 'block'   ? t('contact.confirm_block_body', 'Geblokkeerde contacten kunnen je geen berichten meer sturen.')
        : ''}
        confirmLabel={t('contact.confirm_yes', 'Bevestig')}
        cancelLabel={t('contact.confirm_no',  'Annuleer')}
        onConfirm={
          confirm?.kind === 'mute'   ? runConfirm(onMute)
        : confirm?.kind === 'unmute' ? runConfirm(onUnmute)
        : confirm?.kind === 'block'  ? runConfirm(onBlock)
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
  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted,
    paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  btnDanger: {
    backgroundColor: COLORS.danger,
    paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center',
    marginTop: SPACING.sm,
  },
  btnDangerLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  qrFrame: { alignItems: 'center', marginTop: SPACING.lg },
  qrCaption: {
    marginTop: SPACING.sm, color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs, textAlign: 'center',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZES.md },
});

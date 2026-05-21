/**
 * OnboardIssueScreen — admin shows a freshly-issued invite QR for
 * a new member to scan.
 *
 * Stoop V3 mobile.  Receives the invite token via
 * `route.params.invite` (set by GroupScreen.onIssueInvite).
 *
 * Renders the QR via `components/QrCode`. The encoded payload is
 * the same JSON used by `getInviteQr` on the desktop, so the
 * mobile and desktop QR-scanners interchange.
 */

import React from 'react';
import {
  View, Text, ScrollView, StyleSheet,
} from 'react-native';
import { useRoute } from '@react-navigation/native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/localisation.js';
import { QrCode }                             from '../components/QrCode.js';

export function OnboardIssueScreen() {
  const route = useRoute();
  const invite = route?.params?.invite;
  const payload = invite ? JSON.stringify(invite) : null;

  if (!payload) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('onboard_issue.no_invite',
             'Geen uitnodiging beschikbaar.  Open dit scherm vanuit Groep → Maak uitnodiging.')}
        </Text>
      </View>
    );
  }

  // Stoop's invite is `{groupId, code, expiresAt}`. Show the code as
  // text too — for users who can't / won't scan (paste flow, copy
  // into WhatsApp, read aloud over the phone).
  const codeText = typeof invite?.code === 'string' ? invite.code : null;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>
        {t('onboard_issue.heading', 'Toon deze QR aan je buurman')}
      </Text>
      <Text style={styles.body}>
        {t('onboard_issue.body',
           'Laat het andere toestel deze QR scannen via het Stoop-welkomstscherm.')}
      </Text>
      <View style={styles.qrWrap}>
        <QrCode value={payload} size={280} />
      </View>
      {codeText ? (
        <View style={styles.codeBlock}>
          <Text style={styles.codeLabel}>
            {t('onboard_issue.code_label', 'Of deel deze code:')}
          </Text>
          <Text style={styles.codeValue} selectable>{codeText}</Text>
        </View>
      ) : null}
      <Text style={styles.expiresHint}>
        {invite?.expiresAt
          ? t('onboard_issue.expires_at', 'Geldig tot {ts}')
              .replace('{ts}', new Date(invite.expiresAt).toLocaleString())
          : ''}
      </Text>
    </ScrollView>
  );
}

export default OnboardIssueScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, alignItems: 'center', paddingBottom: SPACING.xxl },
  heading: {
    fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text,
    marginTop: SPACING.lg, textAlign: 'center',
  },
  body: {
    marginTop: SPACING.md, fontSize: FONT_SIZES.md,
    color: COLORS.textMuted, textAlign: 'center', lineHeight: 22,
    paddingHorizontal: SPACING.md,
  },
  qrWrap: {
    marginVertical: SPACING.xl,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
  },
  expiresHint: { fontSize: FONT_SIZES.sm, color: COLORS.textMuted },
  codeBlock: {
    alignItems: 'center', marginBottom: SPACING.md,
  },
  codeLabel: { fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.xs },
  codeValue: {
    fontFamily: 'monospace', fontSize: FONT_SIZES.lg,
    color: COLORS.text, letterSpacing: 1,
  },
  empty:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZES.md, textAlign: 'center' },
});

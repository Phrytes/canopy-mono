/**
 * IssueBotTokenScreen — admin issues a V1.5 cap-token for a chat
 * binding and renders the QR a phone (or another device's bot
 * client) can scan.
 *
 * Phase 41.13 (2026-05-09).
 *
 * Replaces the TODO alert in BotBindingsSection. Reachable from
 * CrewSettings → Bot bindings → Issue token QR. Route param
 * `{chatId, webid}` identifies the binding to issue against; the
 * skill returns the cap-token blob which we encode into a
 * `tasks://bot-token?...` URL.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';

import { useTheme }   from '@canopy/react-native/theme';
import { QrCodeView } from '@canopy/react-native/qr/view';

import { useSkill } from '../lib/useSkill.js';
import { useI18n }  from '../I18nProvider.js';
import { useActiveRole } from '../lib/useActiveRole.js';
import { encodeIssueBotTokenUrl } from '../lib/issueBotTokenUrl.js';

export function IssueBotTokenScreen() {
  const route = useRoute();
  const { isAdmin } = useActiveRole();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const { chatId, webid } = route?.params ?? {};
  const issue = useSkill('issueBotToken');

  const [tokenBlob, setTokenBlob] = useState(null);
  const [error,     setError]     = useState(null);

  const onIssue = useCallback(async () => {
    if (!isAdmin) { setError(t('mobile.issue_bot.admin_only')); return; }
    if (!chatId || !webid) { setError(t('mobile.issue_bot.missing_params')); return; }
    setError(null);
    try {
      const r = await issue.call({ chatId, webid });
      if (r?.error) { setError(r.error); return; }
      const blob = r?.tokenBlob ?? r?.token ?? null;
      if (typeof blob !== 'string' || !blob) {
        setError(t('mobile.issue_bot.empty_token'));
        return;
      }
      setTokenBlob(blob);
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [isAdmin, chatId, webid, issue, t]);

  useEffect(() => { onIssue(); }, [onIssue]);

  const url = (chatId && webid && tokenBlob)
    ? encodeIssueBotTokenUrl({ chatId, webid, tokenBlob })
    : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.xl }}
    >
      <Text style={{
        fontSize: FONT_SIZES.xl, fontWeight: '600',
        color: COLORS.text, marginBottom: SPACING.sm,
      }}>
        {t('mobile.issue_bot.title')}
      </Text>
      <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.lg, lineHeight: 20 }}>
        {t('mobile.issue_bot.subtitle')}
      </Text>

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md }}>
          {error}
        </Text>
      ) : null}

      {url ? (
        <View style={{ alignItems: 'center', marginVertical: SPACING.lg }}>
          <QrCodeView value={url} size={256} />
          <Text style={{ marginTop: SPACING.md, fontSize: FONT_SIZES.xs, color: COLORS.textMuted, fontFamily: 'monospace' }} selectable>
            {chatId} → @{_suffix(webid)}
          </Text>
        </View>
      ) : (
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
          {t('mobile.issue_bot.generating')}
        </Text>
      )}
    </ScrollView>
  );
}

function _suffix(webid) {
  if (typeof webid !== 'string') return '?';
  const i = webid.lastIndexOf('/');
  return i >= 0 ? webid.slice(i + 1) : webid;
}

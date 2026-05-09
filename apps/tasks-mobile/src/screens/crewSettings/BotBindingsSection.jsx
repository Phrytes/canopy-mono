/**
 * BotBindingsSection — V1.5 chat-bot bindings per crew.
 *
 * Phase 41.8.4 (2026-05-09).
 *
 * Admin-only. Lists current `{chatId → webid}` bindings + lets the
 * admin add/remove. The "Issue token" flow that pairs a chat-bound
 * bot's cap-token with a QR (so a phone can scan it) lands in
 * Phase 41.13; this section surfaces a button that navigates there
 * once it ships. For V1.0 the button shows a TODO toast.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useSkill, useSkillResult } from '../../lib/useSkill.js';
import { useI18n }    from '../../I18nProvider.js';
import { useActiveRole } from '../../lib/useActiveRole.js';
import { ROUTES }     from '../../navigation.js';

export function BotBindingsSection() {
  const nav = useNavigation();
  const { isAdmin } = useActiveRole();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const list   = useSkillResult('getBotChatBindings', {});
  const setBind = useSkill('setBotChatBinding');
  const remBind = useSkill('removeBotChatBinding');

  const [chatId, setChatId] = useState('');
  const [webid,  setWebid]  = useState('');
  const [error,  setError]  = useState(null);

  const bindings = list?.data?.bindings ?? list?.data ?? {};
  const entries = Object.entries(bindings).filter(([k]) => typeof k === 'string' && k);

  const onAdd = useCallback(async () => {
    const cid = chatId.trim();
    const wid = webid.trim();
    if (!cid || !wid) return;
    setError(null);
    try {
      const r = await setBind.call({ chatId: cid, webid: wid });
      if (r?.error) { setError(r.error); return; }
      setChatId(''); setWebid('');
      list.refresh().catch(() => {});
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [chatId, webid, setBind, list]);

  const onRemove = useCallback(async (cid) => {
    try {
      await remBind.call({ chatId: cid });
      list.refresh().catch(() => {});
    } catch { /* swallow — list refresh covers UI */ }
  }, [remBind, list]);

  if (!isAdmin) {
    return (
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
        {t('mobile.crew_settings.admin_only')}
      </Text>
    );
  }

  return (
    <View>
      {entries.length === 0 ? (
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md }}>
          {t('mobile.crew_settings.bot_bindings_empty')}
        </Text>
      ) : entries.map(([cid, wid]) => (
        <View
          key={cid}
          style={{
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
            backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
            borderRadius: RADII.sm, marginBottom: 4,
          }}
        >
          <Text numberOfLines={1} style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
            chatId: {String(cid).slice(0, 24)}…
          </Text>
          <Text numberOfLines={1} style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}>
            → @{_suffix(String(wid))}
          </Text>
          <View style={{ flexDirection: 'row', marginTop: SPACING.sm, gap: SPACING.sm }}>
            <Pressable
              onPress={() => nav.navigate(ROUTES.IssueBotToken, { chatId: cid, webid: wid })}
              accessibilityRole="button"
              accessibilityLabel={`bot-binding-issue-${cid}`}
              style={{
                paddingVertical: 4, paddingHorizontal: SPACING.sm,
                borderRadius: RADII.pill, backgroundColor: COLORS.primary,
              }}
            >
              <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.xs }}>
                {t('mobile.crew_settings.issue_token_cta')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onRemove(cid)}
              accessibilityRole="button"
              accessibilityLabel={`bot-binding-remove-${cid}`}
              style={{
                paddingVertical: 4, paddingHorizontal: SPACING.sm,
                borderRadius: RADII.pill, backgroundColor: COLORS.danger,
              }}
            >
              <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.xs }}>
                {t('mobile.common.delete')}
              </Text>
            </Pressable>
          </View>
        </View>
      ))}

      <View style={{ marginTop: SPACING.md }}>
        <TextInput
          value={chatId}
          onChangeText={setChatId}
          placeholder={t('mobile.crew_settings.bot_chat_id_placeholder')}
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          accessibilityLabel="bot-chat-id-input"
          style={_inputStyle(COLORS, SPACING, FONT_SIZES, RADII)}
        />
        <TextInput
          value={webid}
          onChangeText={setWebid}
          placeholder={t('mobile.crew_settings.bot_webid_placeholder')}
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          accessibilityLabel="bot-webid-input"
          style={[_inputStyle(COLORS, SPACING, FONT_SIZES, RADII), { marginTop: SPACING.sm }]}
        />
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="bot-binding-add"
          style={{
            marginTop: SPACING.sm,
            alignSelf: 'flex-start',
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
            borderRadius: RADII.pill, backgroundColor: COLORS.primary,
          }}
        >
          <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '600' }}>
            {t('mobile.crew_settings.bot_binding_add')}
          </Text>
        </Pressable>

      </View>

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.xs, marginTop: SPACING.sm }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function _inputStyle(COLORS, SPACING, FONT_SIZES, RADII) {
  return {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    padding: SPACING.sm, fontSize: FONT_SIZES.sm, color: COLORS.text,
    backgroundColor: COLORS.surface,
  };
}

function _suffix(webid) {
  if (typeof webid !== 'string') return '?';
  const i = webid.lastIndexOf('/');
  return i >= 0 ? webid.slice(i + 1) : webid;
}

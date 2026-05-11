/**
 * ChatThreadScreen — single 1:1 chat thread.
 *
 * Phase 41.18.4 (2026-05-10).
 *
 * Wraps `getChatThread` + `sendChatMessage` (added to tasks-v0 in
 * 41.18.4 alongside this screen). The thread-id convention used by
 * the appeal flow is `appeal:<taskId>`; this screen accepts any
 * threadId so it's reusable for future chat surfaces.
 *
 * route.params:
 *   - `{threadId}` — required; the thread to display.
 *   - `{counterparty}` — optional webid of the peer (for header label).
 *   - `{appealForTaskId}` — optional task id; when set + the thread
 *      has no messages yet, the screen offers an "Open appeal"
 *      shortcut that fires `appealTask({taskId})` instead of
 *      `sendChatMessage`. After the appeal opens, normal send takes over.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useSkill, useSkillResult, useAgentEvent } from '../lib/useSkill.js';
import { useI18n }    from '../I18nProvider.js';

export function ChatThreadScreen() {
  const route = useRoute();
  const nav   = useNavigation();
  const svc   = useService();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const threadId       = route?.params?.threadId       ?? null;
  const counterparty   = route?.params?.counterparty   ?? null;
  const appealForTaskId = route?.params?.appealForTaskId ?? null;

  const [body,   setBody]   = useState('');
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState(null);

  const sendSk   = useSkill('sendChatMessage');
  const appealSk = useSkill('appealTask');
  const list     = useSkillResult('getChatThread', threadId ? { threadId } : null, [threadId]);

  // Refresh on inbound messages (chat-p2p emits via the agent).
  const arrived = useAgentEvent('chat-message-arrive');
  useEffect(() => {
    if (arrived != null) list.refresh().catch(() => {});
  }, [arrived, list]);

  const messages = useMemo(() => {
    const arr = Array.isArray(list?.data?.messages) ? list.data.messages : [];
    return arr.map((m) => ({
      id:        m?.id ?? `${m?.source?.sentAt ?? Math.random()}`,
      from:      m?.source?.fromWebid ?? m?.addedBy ?? null,
      to:        m?.source?.toWebid   ?? null,
      ts:        m?.source?.sentAt    ?? m?.addedAt ?? 0,
      body:      m?.text ?? m?.body ?? '',
    }));
  }, [list?.data]);

  const selfWebid = svc?.identity?.webid ?? null;

  const recipient = useMemo(() => {
    if (counterparty) return counterparty;
    // Heuristic: pick the not-self party out of the existing thread.
    for (const m of messages) {
      if (m.from && m.from !== selfWebid) return m.from;
      if (m.to   && m.to   !== selfWebid) return m.to;
    }
    return null;
  }, [counterparty, messages, selfWebid]);

  const onSend = useCallback(async () => {
    const text = body.trim();
    if (!text || busy || !threadId) return;
    setBusy(true);
    setError(null);
    try {
      // First-message-from-the-revoked-assignee path: appealTask
      // opens the thread with the master automatically — same as
      // tapping "Appeal" on TaskDetail. Subsequent messages route
      // through sendChatMessage normally.
      const useAppeal = appealForTaskId && messages.length === 0;
      const r = useAppeal
        ? await appealSk.call({ taskId: appealForTaskId, body: text })
        : await sendSk.call({
            threadId,
            toWebid: recipient ?? undefined,
            body:    text,
          });
      if (r?.error) {
        setError(String(r.error));
        return;
      }
      setBody('');
      list.refresh().catch(() => {});
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [body, busy, threadId, appealForTaskId, messages.length, appealSk, sendSk, recipient, list]);

  if (!threadId) {
    return (
      <View style={{ flex: 1, padding: SPACING.xl, backgroundColor: COLORS.background }}>
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.md }}>
          {t('mobile.chat.no_thread')}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{
        padding: SPACING.md,
        borderBottomWidth: 1, borderBottomColor: COLORS.border,
      }}>
        <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '600' }}>
          {recipient ? `@${_short(recipient)}` : t('mobile.chat.unknown_peer')}
        </Text>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 }}>
          {threadId}
        </Text>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: SPACING.md, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={{ padding: SPACING.xl }}>
            {list?.loading ? (
              <ActivityIndicator color={COLORS.primary} />
            ) : (
              <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm, textAlign: 'center' }}>
                {appealForTaskId
                  ? t('mobile.chat.appeal_empty')
                  : t('mobile.chat.empty')}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const mine = item.from && item.from === selfWebid;
          return (
            <View style={{
              alignSelf: mine ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
              marginBottom: SPACING.sm,
              padding: SPACING.md,
              borderRadius: RADII.md,
              backgroundColor: mine ? COLORS.primary : COLORS.surface,
              borderWidth: mine ? 0 : 1,
              borderColor: COLORS.border,
            }}>
              <Text style={{
                color: mine ? COLORS.textInverse : COLORS.text,
                fontSize: FONT_SIZES.sm,
              }}>
                {item.body}
              </Text>
              <Text style={{
                color: mine ? COLORS.textInverse : COLORS.textMuted,
                fontSize: 10, opacity: 0.8, marginTop: 4,
              }}>
                {item.from ? `@${_short(item.from)}` : ''}{item.ts ? ` · ${_fmtTime(item.ts)}` : ''}
              </Text>
            </View>
          );
        }}
      />

      {error ? (
        <Text style={{
          color: COLORS.danger, fontSize: FONT_SIZES.sm,
          paddingHorizontal: SPACING.md,
        }}>
          {error}
        </Text>
      ) : null}

      <View style={{
        flexDirection: 'row', alignItems: 'flex-end',
        padding: SPACING.md,
        borderTopWidth: 1, borderTopColor: COLORS.border,
        gap: SPACING.sm,
      }}>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={t('mobile.chat.input_placeholder')}
          placeholderTextColor={COLORS.textMuted}
          multiline
          accessibilityLabel="chat-input"
          style={{
            flex: 1,
            minHeight: 40,
            maxHeight: 120,
            borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
            padding: SPACING.sm, fontSize: FONT_SIZES.md, color: COLORS.text,
            backgroundColor: COLORS.surface,
            textAlignVertical: 'top',
          }}
        />
        <Pressable
          onPress={onSend}
          disabled={busy || body.trim().length === 0}
          accessibilityRole="button"
          accessibilityLabel="chat-send"
          style={{
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
            borderRadius: RADII.sm,
            backgroundColor: (busy || body.trim().length === 0) ? COLORS.surfaceMuted : COLORS.primary,
          }}
        >
          <Text style={{
            color: (busy || body.trim().length === 0) ? COLORS.textMuted : COLORS.textInverse,
            fontSize: FONT_SIZES.md, fontWeight: '600',
          }}>
            {busy ? '…' : t('mobile.chat.send')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function _short(s) {
  if (typeof s !== 'string') return '';
  const i = s.lastIndexOf('/');
  const tail = i >= 0 ? s.slice(i + 1) : s;
  return tail.length > 14 ? tail.slice(0, 14) + '…' : tail;
}

function _fmtTime(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

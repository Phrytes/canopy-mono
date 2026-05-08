/**
 * ChatThreadScreen — single 1:1 chat thread.
 *
 * Stoop V3 mobile.  Phase 40.17 (2026-05-08): wired to the live
 * agent.  Reveal handshake header CTA calls `requestReveal`; the
 * peer's reveal-back lands as a `chat-message-arrive` with
 * `subtype: 'reveal-request'` which the agent processes via
 * Reveals.setPeerReveal — the screen re-renders on the next refresh.
 *
 * route.params: `{ threadId, peerId }`.  When threadId is missing
 * but peerId is set, derives a deterministic threadId from the two
 * pubKeys (sorted-pair). Stoop's chat substrate uses this convention.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, Image, StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/i18n.js';
import { validateChatDraft, groupConsecutive, CHAT_MAX_BODY_LEN }
                                              from '../lib/chat.js';
import { attachmentUri }                      from '../lib/post.js';
import { pickChatImage }                      from '../lib/imagePicker.js';
import { AvatarCircle }                       from '../components/AvatarCircle.js';
import { AttachmentModal }                    from '../components/AttachmentModal.js';
import { useService }                         from '../ServiceContext.js';
import { useSkill }                           from '../lib/useSkill.js';
import { useSkillResult }                     from '../lib/useSkillResult.js';
import { useAgentEvent }                      from '../lib/useAgentEvent.js';

export function ChatThreadScreen() {
  useNavigation();
  const route = useRoute();
  const svc = useService();

  const peerId   = route?.params?.peerId   ?? null;
  const threadIdRouted = route?.params?.threadId ?? null;
  const threadId = threadIdRouted ?? _deriveThreadId(svc, peerId);

  const [text, setText]             = useState('');
  const [attachment, setAttachment] = useState(null);
  const [error, setError]           = useState(null);
  const [modalView, setModalView]   = useState(null);

  const sendCall    = useSkill('sendChatMessage');
  const revealCall  = useSkill('requestReveal');
  const { data, loading, refresh } = useSkillResult(
    'getChatThread', threadId ? { threadId } : null, [threadId],
  );

  // Re-fetch on inbound messages (the agent emits on receive).
  const arrived = useAgentEvent('chat-message-arrive');
  useEffect(() => {
    if (arrived != null) refresh().catch(() => { /* swallow */ });
  }, [arrived, refresh]);

  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('chat_thread.no_active_group',
             'Sluit eerst aan bij een groep om gesprekken te zien.')}
        </Text>
      </View>
    );
  }
  if (!peerId) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('chat_thread.no_peer', 'Geen gesprekspartner.')}
        </Text>
      </View>
    );
  }

  // Resolve peer details from MemberMap.
  const members = svc.activeBundle.members;
  const peer = (() => {
    try {
      return members?.resolveByStableId?.(peerId)
          ?? members?.resolveByWebid?.(peerId)
          ?? members?.resolveByPubKey?.(peerId)
          ?? null;
    } catch { return null; }
  })();
  const reveals  = svc.activeBundle.reveals;
  const revealedFromMe = peer && reveals?.hasRevealed?.(peer.stableId ?? peer.webid ?? peer.pubKey);
  const revealed = !!(peer?.revealed || revealedFromMe);
  // Prefer revealed display name → handle → short pubKey prefix
  // (so two handle-less peers don't both render as "@unknown" and
  // become indistinguishable from a self-chat). Falls back to
  // `unknown` only when literally nothing is known.
  const peerPkPrefix = (typeof peerId === 'string' && peerId.length > 8)
    ? peerId.slice(0, 8) + '…'
    : null;
  const peerName = (revealed && peer?.displayName)
    ? peer.displayName
    : peer?.handle
        ? `@${peer.handle}`
        : peerPkPrefix
            ? `@${peerPkPrefix}`
            : '@unknown';

  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const groups   = groupConsecutive(messages.map((m) => ({
    from:       m.source?.fromWebid ?? m.addedBy,
    ts:         m.source?.sentAt ?? m.addedAt,
    text:       m.text,
    attachment: m.source?.extras?.attachment,
  })));

  const selfAddr = svc.activeBundle.agent.address ?? svc.activeBundle.agent.identity?.pubKey;

  const draft = { text, attachment };
  const v = validateChatDraft(draft);

  const send = useCallback(async () => {
    if (!v.ok || sendCall.loading) return;
    setError(null);
    try {
      await sendCall.call({
        threadId,
        toPubKey:    peer?.pubKey ?? peerId,
        toStableId:  peer?.stableId,
        toWebid:     peer?.webid,
        body:        text.trim() || undefined,
        attachment:  attachment ?? undefined,
      });
      setText('');
      setAttachment(null);
      await refresh();
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [v.ok, sendCall, threadId, peer, peerId, text, attachment, refresh]);

  const requestReveal = useCallback(async () => {
    setError(null);
    try {
      await revealCall.call({
        threadId,
        peerStableId: peer?.stableId,
        peerWebid:    peer?.webid,
      });
      await refresh();
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [revealCall, threadId, peer, refresh]);

  const pickPhoto = useCallback(async (mode) => {
    setError(null);
    try {
      const blob = await pickChatImage({ mode });
      if (!blob) return;
      setAttachment(blob);
    } catch (err) {
      if (err?.code === 'PERMISSION_DENIED') {
        setError(t('compose.permission_denied',
                   'Stoop heeft geen toestemming voor camera/galerij.'));
      } else setError(err?.message ?? String(err));
    }
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <AvatarCircle uri={peer?.avatarUrl ?? peer?.avatarUri} name={peerName} size={36} />
        <View style={styles.headerText}>
          <Text style={styles.peerName} numberOfLines={1}>{peerName}</Text>
          {!revealed ? (
            <Pressable
              onPress={requestReveal}
              accessibilityRole="button"
              accessibilityLabel="chat-request-reveal"
            >
              <Text style={styles.revealLink}>
                {revealCall.loading
                  ? t('chat_thread.revealing', 'Versturen…')
                  : t('chat_thread.request_reveal', 'Vraag echte naam')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={groups}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <BubbleGroup
            group={item}
            isSelf={item.from === selfAddr}
            onPressAttachment={(att) => setModalView(att)}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshing={loading}
        onRefresh={refresh}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {t('chat_thread.empty', 'Nog geen berichten.')}
            </Text>
          </View>
        )}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {attachment ? (
        <View style={styles.attachmentPreview}>
          {attachmentUri(attachment) ? (
            <Image source={{ uri: attachmentUri(attachment) }} style={styles.previewImg} />
          ) : null}
          <Pressable
            onPress={() => setAttachment(null)}
            style={styles.attachmentClear}
            accessibilityRole="button"
            accessibilityLabel="chat-clear-attachment"
          >
            <Text style={styles.attachmentClearLabel}>×</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.composer}>
        <Pressable
          onPress={() => pickPhoto('camera')}
          style={styles.composerBtn}
          accessibilityRole="button"
          accessibilityLabel="chat-capture-photo"
        >
          <Text style={styles.composerBtnLabel}>📷</Text>
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          maxLength={CHAT_MAX_BODY_LEN}
          placeholder={t('chat_thread.placeholder', 'Schrijf een bericht…')}
          style={styles.composerInput}
          accessibilityLabel="chat-input"
          multiline
        />
        <Pressable
          onPress={send}
          disabled={!v.ok || sendCall.loading}
          style={[styles.sendBtn, (!v.ok || sendCall.loading) && styles.sendBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="chat-send"
        >
          <Text style={styles.sendBtnLabel}>{sendCall.loading ? '…' : '➤'}</Text>
        </Pressable>
      </View>

      <AttachmentModal
        visible={!!modalView}
        attachments={modalView ? [modalView] : []}
        initialIndex={0}
        onClose={() => setModalView(null)}
      />
    </View>
  );
}

/**
 * Derive the deterministic threadId from a self-pubKey + peer-pubKey
 * sorted pair. Matches the Stoop chat substrate's convention so two
 * sides of the same conversation arrive at the same threadId
 * independently.
 */
function _deriveThreadId(svc, peerId) {
  if (!peerId || !svc?.activeBundle) return null;
  const self = svc.activeBundle.agent.address ?? svc.activeBundle.agent.identity?.pubKey;
  if (!self) return null;
  const [a, b] = [self, peerId].sort();
  return `${a}~${b}`;
}

function BubbleGroup({ group, isSelf, onPressAttachment }) {
  return (
    <View style={[styles.bubbleRow, isSelf ? styles.bubbleRowSelf : styles.bubbleRowPeer]}>
      <View style={[styles.bubbleStack, isSelf && styles.bubbleStackSelf]}>
        {group.items.map((m, i) => (
          <Bubble key={i} message={m} isSelf={isSelf} onPressAttachment={onPressAttachment} />
        ))}
      </View>
    </View>
  );
}

function Bubble({ message, isSelf, onPressAttachment }) {
  const att = message?.attachment;
  const uri = att ? attachmentUri(att) : null;
  return (
    <View style={[styles.bubble, isSelf ? styles.bubbleSelf : styles.bubblePeer]}>
      {uri ? (
        <Pressable
          onPress={() => onPressAttachment?.(att)}
          accessibilityRole="button"
          accessibilityLabel="chat-bubble-attachment"
        >
          <Image source={{ uri }} style={styles.bubbleImage} />
        </Pressable>
      ) : null}
      {message?.text ? (
        <Text style={[styles.bubbleText, isSelf && styles.bubbleTextSelf]}>
          {message.text}
        </Text>
      ) : null}
    </View>
  );
}

export default ChatThreadScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    padding: SPACING.md, backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerText: { marginLeft: SPACING.md, flex: 1 },
  peerName:   { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text },
  revealLink: { fontSize: FONT_SIZES.xs, color: COLORS.info, marginTop: 2 },
  listContent: { padding: SPACING.md, flexGrow: 1 },
  bubbleRow:    { flexDirection: 'row', marginBottom: SPACING.sm },
  bubbleRowSelf: { justifyContent: 'flex-end' },
  bubbleRowPeer: { justifyContent: 'flex-start' },
  bubbleStack:  { maxWidth: '78%' },
  bubbleStackSelf: { alignItems: 'flex-end' },
  bubble: {
    backgroundColor: COLORS.surface, padding: SPACING.md,
    borderRadius: RADII.md, marginVertical: 2,
    borderWidth: 1, borderColor: COLORS.border,
  },
  bubbleSelf: { backgroundColor: COLORS.primary, borderColor: COLORS.primaryDark },
  bubblePeer: { backgroundColor: COLORS.surface },
  bubbleText:     { color: COLORS.text, fontSize: FONT_SIZES.md, lineHeight: 22 },
  bubbleTextSelf: { color: COLORS.textInverse },
  bubbleImage: {
    width: 220, height: 220, borderRadius: RADII.sm,
    backgroundColor: COLORS.surfaceMuted, marginBottom: SPACING.sm,
  },
  empty:     { padding: SPACING.xxl, alignItems: 'center' },
  emptyText: { fontSize: FONT_SIZES.md, color: COLORS.textMuted },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  attachmentPreview: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface, position: 'relative',
    borderTopWidth: 1, borderColor: COLORS.border,
  },
  previewImg: { width: 96, height: 96, borderRadius: RADII.sm },
  attachmentClear: {
    position: 'absolute', top: 4, left: SPACING.md + 88,
    width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.danger,
    alignItems: 'center', justifyContent: 'center',
  },
  attachmentClearLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end',
    padding: SPACING.sm, backgroundColor: COLORS.surface,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  composerBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  composerBtnLabel: { fontSize: FONT_SIZES.lg },
  composerInput: {
    flex: 1, minHeight: 40, maxHeight: 120,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.md,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    fontSize: FONT_SIZES.md, color: COLORS.text,
    marginRight: SPACING.sm,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: RADII.pill,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.surfaceMuted },
  sendBtnLabel:    { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
});

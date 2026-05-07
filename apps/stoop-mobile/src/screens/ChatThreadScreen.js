/**
 * ChatThreadScreen — single 1:1 chat thread.
 *
 * Stoop V3 mobile.  Inverted FlatList so newest message anchors at
 * the bottom; tap-to-fullscreen on a photo attachment opens the
 * AttachmentModal.  A "Reveal real name" CTA in the header surfaces
 * the bilateral-reveal flow when the names aren't yet shared.
 *
 * Pure UI: bring-up code in 40.10-H injects:
 *   - `messages`, `peer`, `revealed` (live-updated by chat-p2p).
 *   - `onSend({ text, attachment? })`.
 *   - `onRequestReveal()`.
 *   - `onCapturePhoto()` / `onPickPhoto()` from imagePicker.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, Image, StyleSheet, Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/i18n.js';
import { validateChatDraft, groupConsecutive, CHAT_MAX_BODY_LEN }
                                              from '../lib/chat.js';
import { attachmentUri }                      from '../lib/post.js';
import { AvatarCircle }                       from '../components/AvatarCircle.js';
import { AttachmentModal }                    from '../components/AttachmentModal.js';

/**
 * @param {object} props
 * @param {object} [props.peer]   `{handle, avatarUri, displayName?}`
 * @param {boolean} [props.revealed]
 * @param {string}  [props.selfId]
 * @param {Array<{from: string, ts?: number, text?: string, attachment?: object}>} [props.messages]
 * @param {(draft: object) => Promise<unknown>} [props.onSend]
 * @param {() => Promise<void>}                [props.onRequestReveal]
 * @param {() => Promise<object|null>}         [props.onCapturePhoto]
 * @param {() => Promise<object|null>}         [props.onPickPhoto]
 */
export function ChatThreadScreen({
  peer, revealed = false, selfId,
  messages = [],
  onSend, onRequestReveal, onCapturePhoto, onPickPhoto,
} = {}) {
  // Kept for future header overflow (back button + reveal CTA).
  useNavigation();
  useRoute();

  const [text, setText]             = useState('');
  const [attachment, setAttachment] = useState(null);
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState(null);
  const [modalView, setModalView]   = useState(null);

  const draft = { text, attachment };
  const v = validateChatDraft(draft);

  const send = useCallback(async () => {
    if (!v.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (onSend) await onSend({ text: text.trim(), attachment });
      setText('');
      setAttachment(null);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, v.ok, text, attachment, onSend]);

  const pickPhoto = useCallback(async (which) => {
    setError(null);
    try {
      const fn = which === 'capture' ? onCapturePhoto : onPickPhoto;
      if (!fn) return;
      const r = await fn();
      if (!r) return;
      setAttachment(r);
    } catch (err) {
      if (err?.code === 'PERMISSION_DENIED') {
        setError(t('compose.permission_denied',
                   'Stoop heeft geen toestemming voor camera/galerij.'));
      } else {
        setError(err?.message ?? String(err));
      }
    }
  }, [onCapturePhoto, onPickPhoto]);

  const groups = groupConsecutive(messages);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <AvatarCircle uri={peer?.avatarUri} name={peer?.handle ?? '·'} size={36} />
        <View style={styles.headerText}>
          <Text style={styles.peerName} numberOfLines={1}>
            {revealed && peer?.displayName ? peer.displayName : `@${peer?.handle ?? 'unknown'}`}
          </Text>
          {!revealed && peer?.handle ? (
            <Pressable
              onPress={async () => {
                if (!onRequestReveal) {
                  Alert.alert(t('chat_thread.reveal_unavailable',
                                'Reveal-flow is not available in this build.'));
                  return;
                }
                try { await onRequestReveal(); }
                catch (err) { setError(err?.message ?? String(err)); }
              }}
              accessibilityRole="button"
              accessibilityLabel="chat-request-reveal"
            >
              <Text style={styles.revealLink}>
                {t('chat_thread.request_reveal', 'Vraag echte naam')}
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
            isSelf={item.from === selfId}
            onPressAttachment={(att) => setModalView(att)}
          />
        )}
        contentContainerStyle={styles.listContent}
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
          onPress={() => pickPhoto('capture')}
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
          disabled={!v.ok || busy}
          style={[styles.sendBtn, (!v.ok || busy) && styles.sendBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="chat-send"
        >
          <Text style={styles.sendBtnLabel}>{busy ? '…' : '➤'}</Text>
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

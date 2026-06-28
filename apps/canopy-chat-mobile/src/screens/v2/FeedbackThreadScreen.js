/**
 * canopy-chat-mobile v2 — dedicated FEEDBACK bot thread (cluster J, mobile parity).
 *
 * RN mirror of web's `showFeedbackThread` (circleApp.js). The feedback bot is an
 * added contact (via invite link/QR), NOT a PeerGraph peer — so it gets its own
 * thread that hosts the SHARED feedback surface: activate the verify-summary pods
 * (own/central/control) from the RN session, build the surface, and route input →
 * `surface.handle` / button taps → `surface.tapButton`. Unlike ContactThreadScreen
 * this renders the bot's BUTTONS (the consent + verify-summary rails) and shows a
 * "thinking" state while the on-device AI clean/summarise runs (a few seconds).
 *
 * Own-pod-first: raw stays on the participant's own pod; only the verified summary
 * they approve reaches central. All curation logic is shared web≡mobile — this is
 * just the RN shell.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { theme } from './theme.js';
import { createFeedbackSurface } from '../../../../canopy-chat/src/feedback/feedbackSurface.js';
import { activateMobileFeedback } from '../../v2/feedbackActivation.js';

// Same EXPO_PUBLIC_* vars ChatScreen reads (model override included — the default qwen2.5 404s on Privatemode).
const FEEDBACK_LLM_BASEURL = process.env.EXPO_PUBLIC_FEEDBACK_LLM_BASEURL || undefined;
const FEEDBACK_LLM_MODEL = process.env.EXPO_PUBLIC_FEEDBACK_LLM_MODEL || undefined;
const FEEDBACK_ACTIVATION_URL = process.env.EXPO_PUBLIC_FEEDBACK_ACTIVATION_URL || null;

export default function FeedbackThreadScreen({ session, bot, store, onBack }) {
  const threadId = bot?.id;
  const name = bot?.name ?? bot?.label ?? threadId ?? 'Feedback';

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);   // inline ✏ — which point is being reworded
  const surfaceRef = useRef(null);
  const startedRef = useRef(false);
  const scrollRef = useRef(null);
  const reviewPointsRef = useRef([]);                 // latest review points (for ✏ pre-fill)

  const pushBot = useCallback((text, buttons) => {
    setMessages((prev) => [...prev, { id: mkId(), origin: 'bot', text: String(text ?? ''), buttons: Array.isArray(buttons) && buttons.length ? buttons : null }]);
  }, []);
  const pushUser = useCallback((text) => {
    setMessages((prev) => [...prev, { id: mkId(), origin: 'user', text: String(text ?? '') }]);
  }, []);

  // Activate (own/central/control pods) + build the surface, then poll the lead's /control/ round. Runs
  // once per open; persists podRef so a re-open reuses the container (the cohort code is single-use).
  useEffect(() => {
    if (startedRef.current || !threadId) return undefined;
    startedRef.current = true;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const activationUrl = bot?.activationUrl || FEEDBACK_ACTIVATION_URL;
        if (!activationUrl) { pushBot(t('circle.feedback.activation_failed', { error: 'no activation URL', defaultValue: 'Activatie mislukt: geen activation-URL ingesteld.' })); return; }
        const pods = await activateMobileFeedback({ session, activationUrl, projectId: bot.projectId, code: bot.code, podRef: bot.podRef });
        if (cancelled) return;
        if (pods.podRef && pods.podRef !== bot.podRef && store) { try { await store.add({ ...bot, podRef: pods.podRef }); } catch { /* persist best-effort */ } }
        const surface = createFeedbackSurface({
          projectId: bot.projectId,   // bind the dispatcher to the activation project (verify-round match)
          llmBaseURL: FEEDBACK_LLM_BASEURL,
          llmModel: FEEDBACK_LLM_MODEL,
          pod: pods.ownPod,
          centralPod: pods.centralPod,
          controlStore: pods.controlStore,
          emit: ({ text, buttons, kind, points }) => { if (kind === 'review' && Array.isArray(points)) reviewPointsRef.current = points; pushBot(text, buttons); },
        });
        surfaceRef.current = surface;
        await surface.start(threadId);   // /help + the /control/ verify-round poll (emits the summary bubble)
      } catch (e) {
        if (!cancelled) pushBot(`⚠ ${e?.message ?? e}`);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session, bot, store, threadId, pushBot]);

  const onSend = useCallback(async () => {
    const text = input.trim();
    const surface = surfaceRef.current;
    if (!text || !surface) return;
    setInput('');
    const editId = editingId; setEditingId(null);
    // inline edit → rewrite that point in place (fp:edit), no echoed user bubble; else a normal turn.
    if (editId) {
      setBusy(true);
      try { await surface.handle(`fp:edit:${editId}:${text}`, threadId); }
      catch (e) { pushBot(`⚠ ${e?.message ?? e}`); }
      finally { setBusy(false); }
      return;
    }
    pushUser(text);
    setBusy(true);
    try { await surface.handle(text, threadId); }
    catch (e) { pushBot(`⚠ ${e?.message ?? e}`); }
    finally { setBusy(false); }
  }, [input, editingId, threadId, pushUser, pushBot]);

  const onButton = useCallback(async (b) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const id = b.callbackData ?? b.action ?? b.id;
    // inline edit: ✏ a point → pre-fill the composer with its current curated text (no bot round-trip).
    const m = /^fp:edit:(p\d+)$/.exec(id || '');
    const p = m ? reviewPointsRef.current.find((x) => x.id === m[1]) : null;
    if (p) { setEditingId(p.id); setInput(p.text); return; }
    setBusy(true);
    try { await surface.tapButton(id, threadId); }
    catch (e) { pushBot(`⚠ ${e?.message ?? e}`); }
    finally { setBusy(false); }
  }, [threadId, pushBot]);

  return (
    <View style={styles.wrap} testID="feedback-thread-screen">
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="feedback-thread-back">
          <Text style={styles.back}>{t('circle.contacts.back')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('circle.contacts.thread_title', { name })}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.log}
        contentContainerStyle={{ paddingVertical: 8, gap: 8 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd?.({ animated: true })}
      >
        {messages.map((m) => (
          <View key={m.id} style={[styles.msg, m.origin === 'user' ? styles.msgUser : styles.msgBot]}>
            <View style={[styles.bubble, m.origin === 'user' ? styles.bubbleUser : styles.bubbleBot]}>
              <Text style={m.origin === 'user' ? styles.bubbleUserText : styles.bubbleBotText} testID={`feedback-msg-${m.origin}`}>
                {m.text}
              </Text>
            </View>
            {m.buttons && (
              <View style={styles.btnRow}>
                {m.buttons.map((b, i) => (
                  <Pressable
                    key={`${m.id}-b${i}`}
                    style={styles.btn}
                    onPress={() => onButton(b)}
                    accessibilityRole="button"
                    testID={`feedback-btn-${b.callbackData ?? b.action ?? b.id ?? i}`}
                  >
                    <Text style={styles.btnText}>{b.label ?? String(b.callbackData ?? b.id ?? '')}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        ))}
        {busy && <Text style={styles.sending}>{t('circle.contacts.thinking', { defaultValue: 'Bezig…' })}</Text>}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={editingId ? t('circle.feedback.edit_hint', { defaultValue: 'Pas de tekst aan en verstuur' }) : t('circle.contacts.composer', { name })}
          placeholderTextColor={theme.color.inkSoft}
          autoCapitalize="none"
          onSubmitEditing={onSend}
          testID="feedback-thread-input"
        />
        <Pressable style={styles.send} onPress={onSend} accessibilityRole="button" testID="feedback-thread-send">
          <Text style={styles.sendText}>{t('circle.contacts.send')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

let _id = 0;
function mkId() { _id += 1; return `fbt-${_id}`; }

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: theme.color.paper },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginBottom: 8 },
  back: { fontSize: 13, color: theme.color.inkSoft },
  title: { fontFamily: theme.font.serif, fontSize: 18, fontWeight: '600', color: theme.color.ink },
  log: { flex: 1 },
  msg: { maxWidth: '88%' },
  msgUser: { alignSelf: 'flex-end' },
  msgBot: { alignSelf: 'flex-start' },
  bubble: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14 },
  bubbleUser: { backgroundColor: theme.color.accent },
  bubbleBot: { backgroundColor: theme.color.white, borderWidth: 1, borderColor: theme.color.line },
  bubbleUserText: { color: theme.color.white, fontSize: 14, lineHeight: 20 },
  bubbleBotText: { color: theme.color.ink, fontSize: 14, lineHeight: 20 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  btn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.color.accent, backgroundColor: theme.color.white },
  btnText: { fontSize: 13, fontWeight: '600', color: theme.color.accent },
  sending: { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic', paddingHorizontal: 4 },
  composer: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: { flex: 1, fontSize: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  send: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center' },
  sendText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
});

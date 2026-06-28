/**
 * canopy-chat-mobile v2 — dedicated FEEDBACK bot thread (cluster J, mobile parity).
 *
 * RN mirror of web's `showFeedbackThread` (circleApp.js). The feedback bot is an
 * added contact (via invite link/QR), NOT a PeerGraph peer — so it gets its own
 * thread that hosts the SHARED feedback surface: activate the verify-summary pods
 * (own/central/control) from the RN session, build the surface, and route input →
 * `surface.handle` / button taps → `surface.tapButton`.
 *
 * Stage-1 review renders as editable per-point CARDS: the curated text (tap to edit
 * in place), the original shown as a muted labelled chip (never mixed into the body
 * text), and per-card send + a footer (send all / nothing). Own-pod-first: the raw
 * + the edited text stay on the participant's own pod; only the verified summary
 * (Stage 2) reaches central. All curation logic is shared web≡mobile — this is the
 * RN shell.
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
  const [editing, setEditing] = useState(null);   // { mid, id, text } — the review card being edited inline
  const surfaceRef = useRef(null);
  const startedRef = useRef(false);
  const scrollRef = useRef(null);

  const pushBot = useCallback((text, buttons) => {
    setMessages((prev) => [...prev, { id: mkId(), origin: 'bot', text: String(text ?? ''), buttons: Array.isArray(buttons) && buttons.length ? buttons : null }]);
  }, []);
  const pushUser = useCallback((text) => {
    setMessages((prev) => [...prev, { id: mkId(), origin: 'user', text: String(text ?? '') }]);
  }, []);

  // Activate (own/central/control pods) + build the surface, then poll the lead's /control/ round.
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
          // a review renders as editable per-point CARDS (kind:'review'+points); everything else as a bubble.
          emit: ({ text, buttons, kind, points }) => {
            if (kind === 'review' && Array.isArray(points)) {
              setEditing(null);
              setMessages((prev) => [...prev, { id: mkId(), origin: 'bot', kind: 'review', intro: String(text ?? ''), points }]);
            } else { pushBot(text, buttons); }
          },
        });
        surfaceRef.current = surface;
        await surface.start(threadId);   // /help + the /control/ verify-round poll
      } catch (e) {
        if (!cancelled) pushBot(`⚠ ${e?.message ?? e}`);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session, bot, store, threadId, pushBot]);

  // Run a control string (button callback / fp:edit / fp:consent) against the bot.
  const tapControl = useCallback(async (cb) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    setBusy(true);
    try { await surface.handle(cb, threadId); }
    catch (e) { pushBot(`⚠ ${e?.message ?? e}`); }
    finally { setBusy(false); }
  }, [threadId, pushBot]);

  const onSend = useCallback(async () => {
    const text = input.trim();
    const surface = surfaceRef.current;
    if (!text || !surface) return;
    setInput('');
    pushUser(text);
    setBusy(true);
    try { await surface.handle(text, threadId); }
    catch (e) { pushBot(`⚠ ${e?.message ?? e}`); }
    finally { setBusy(false); }
  }, [input, threadId, pushUser, pushBot]);

  const onButton = useCallback((b) => tapControl(b.callbackData ?? b.action ?? b.id), [tapControl]);

  const startEdit = useCallback((mid, p) => setEditing({ mid, id: p.id, text: p.text }), []);
  const saveEdit = useCallback(async () => {
    const e = editing; setEditing(null);
    if (e && String(e.text).trim()) await tapControl(`fp:edit:${e.id}:${String(e.text).trim()}`);
  }, [editing, tapControl]);

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
        {messages.map((m) => {
          if (m.kind === 'review') {
            return (
              <View key={m.id} style={styles.reviewBlock} testID="feedback-review">
                {m.intro ? <Text style={styles.reviewIntro}>{String(m.intro).split('\n\n')[0]}</Text> : null}
                {(m.points || []).map((p) => {
                  const isEditing = editing && editing.mid === m.id && editing.id === p.id;
                  const changed = p.raw && p.raw !== p.text;
                  return (
                    <View key={p.id} style={styles.card} testID={`feedback-card-${p.id}`}>
                      {isEditing ? (
                        <>
                          <TextInput
                            style={styles.cardInput}
                            value={editing.text}
                            onChangeText={(v) => setEditing((e) => ({ ...e, text: v }))}
                            multiline
                            autoFocus
                            testID={`feedback-card-input-${p.id}`}
                          />
                          <View style={styles.cardBtns}>
                            <Pressable style={styles.cardBtnMuted} onPress={() => setEditing(null)}>
                              <Text style={styles.cardBtnMutedText}>{t('circle.feedback.cancel_edit', { defaultValue: 'Annuleer' })}</Text>
                            </Pressable>
                            <Pressable style={styles.cardBtn} onPress={saveEdit} testID={`feedback-card-save-${p.id}`}>
                              <Text style={styles.cardBtnText}>{t('circle.feedback.save_edit', { defaultValue: 'Opslaan' })}</Text>
                            </Pressable>
                          </View>
                        </>
                      ) : (
                        <>
                          <Pressable onPress={() => startEdit(m.id, p)}>
                            <Text style={styles.cardText}>
                              {p.text}{p.edited ? ` ${t('circle.feedback.edited', { defaultValue: '(aangepast)' })}` : ''}
                            </Text>
                          </Pressable>
                          {changed ? (
                            <View style={styles.origRow}>
                              <Text style={styles.origLabel}>{t('circle.feedback.original', { defaultValue: 'origineel' })}</Text>
                              <Text style={styles.origText}>{p.raw}</Text>
                            </View>
                          ) : null}
                          <View style={styles.cardBtns}>
                            <Pressable style={styles.cardBtnMuted} onPress={() => startEdit(m.id, p)} testID={`feedback-card-edit-${p.id}`}>
                              <Text style={styles.cardBtnMutedText}>✏</Text>
                            </Pressable>
                            <Pressable style={styles.cardBtn} onPress={() => tapControl(`fp:consent:${p.id}`)}>
                              <Text style={styles.cardBtnText}>{t('circle.feedback.send_one', { defaultValue: 'Verstuur' })}</Text>
                            </Pressable>
                          </View>
                        </>
                      )}
                    </View>
                  );
                })}
                <View style={styles.reviewFooter}>
                  <Pressable style={styles.cardBtn} onPress={() => tapControl('fp:consent:all')}>
                    <Text style={styles.cardBtnText}>{t('circle.feedback.send_all', { defaultValue: 'Alles versturen' })}</Text>
                  </Pressable>
                  <Pressable style={styles.cardBtnMuted} onPress={() => tapControl('fp:cancel')}>
                    <Text style={styles.cardBtnMutedText}>{t('circle.feedback.send_none', { defaultValue: 'Niets versturen' })}</Text>
                  </Pressable>
                </View>
              </View>
            );
          }
          return (
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
          );
        })}
        {busy && <Text style={styles.sending}>{t('circle.contacts.thinking', { defaultValue: 'Bezig…' })}</Text>}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={t('circle.contacts.composer', { name })}
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

// Seed from the clock so a Fast-Refresh reload (which resets module state but KEEPS component state) can't
// re-issue an id already in `messages` → no "two children with the same key".
let _id = Date.now();
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
  // ── Stage-1 review cards ────────────────────────────────────────────────────
  reviewBlock: { gap: 8, marginVertical: 4 },
  reviewIntro: { fontSize: 13, color: theme.color.inkSoft, lineHeight: 18 },
  card: { backgroundColor: theme.color.white, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, padding: 12, gap: 8 },
  cardText: { fontSize: 15, color: theme.color.ink, lineHeight: 21 },
  origRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.color.line, paddingTop: 8 },
  origLabel: { fontSize: 10, fontWeight: '700', color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 },
  origText: { flex: 1, fontSize: 13, color: theme.color.inkSoft, fontStyle: 'italic', lineHeight: 18 },
  cardInput: { fontSize: 15, color: theme.color.ink, lineHeight: 21, borderWidth: 1.5, borderColor: theme.color.accent, borderRadius: theme.radius.md, padding: 10, minHeight: 64, textAlignVertical: 'top', backgroundColor: theme.color.paper },
  cardBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  cardBtn: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 12, backgroundColor: theme.color.accent },
  cardBtnText: { fontSize: 13, fontWeight: '600', color: theme.color.white },
  cardBtnMuted: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.color.line },
  cardBtnMutedText: { fontSize: 13, fontWeight: '600', color: theme.color.inkSoft },
  reviewFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 2 },
  sending: { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic', paddingHorizontal: 4 },
  composer: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: { flex: 1, fontSize: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  send: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center' },
  sendText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
});

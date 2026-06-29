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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t, lang } from '../../core/localisation.js';
import { theme } from './theme.js';
import { createFeedbackSurface } from '../../../../canopy-chat/src/feedback/feedbackSurface.js';
import { activateMobileFeedback } from '../../v2/feedbackActivation.js';

// Same EXPO_PUBLIC_* vars ChatScreen reads (model override included — the default qwen2.5 404s on Privatemode).
const FEEDBACK_LLM_BASEURL = process.env.EXPO_PUBLIC_FEEDBACK_LLM_BASEURL || undefined;
const FEEDBACK_LLM_MODEL = process.env.EXPO_PUBLIC_FEEDBACK_LLM_MODEL || undefined;
const FEEDBACK_ACTIVATION_URL = process.env.EXPO_PUBLIC_FEEDBACK_ACTIVATION_URL || null;

export default function FeedbackThreadScreen({ session, bot, store, onBack }) {
  const insets = useSafeAreaInsets();   // clear the status bar so the header (back + language toggle) is tappable
  const threadId = bot?.id;
  const name = bot?.name ?? bot?.label ?? threadId ?? 'Feedback';

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);   // { mid, id, text } — the review card being edited inline
  const [botLang, setBotLang] = useState(null);    // the participant's chosen bot language (null until loaded)
  const [podsReady, setPodsReady] = useState(false);
  const surfaceRef = useRef(null);
  const activatedLangRef = useRef(null);           // the lang the surface was last (re)built for
  const podsRef = useRef(null);                    // activated pods, cached so a language switch needn't re-activate
  const scrollRef = useRef(null);

  // chrome (header/composer) renders in the BOT's chosen language, not the device locale.
  const tBot = useCallback((key, params) => t(key, params, botLang || undefined), [botLang]);

  // Load the per-bot language choice (persisted); default to the device locale.
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(`fp.lang.${threadId}`).then((v) => { if (live) setBotLang(v === 'nl' || v === 'en' ? v : lang()); }).catch(() => { if (live) setBotLang(lang()); });
    return () => { live = false; };
  }, [threadId]);

  const changeLang = useCallback((lg) => {
    if (lg === botLang || (lg !== 'nl' && lg !== 'en')) return;
    setBotLang(lg);                                 // → the surface effect re-builds the bot in this language
    AsyncStorage.setItem(`fp.lang.${threadId}`, lg).catch(() => { /* best-effort */ });
  }, [botLang, threadId]);

  const pushBot = useCallback((text, buttons) => {
    setMessages((prev) => [...prev, { id: mkId(), origin: 'bot', text: String(text ?? ''), buttons: Array.isArray(buttons) && buttons.length ? buttons : null }]);
  }, []);
  const pushUser = useCallback((text) => {
    setMessages((prev) => [...prev, { id: mkId(), origin: 'user', text: String(text ?? '') }]);
  }, []);

  // (A) Activate ONCE (own/central/control pods) — independent of language, so switching language doesn't
  // re-activate. Caches the pods for the surface builder below.
  useEffect(() => {
    if (!threadId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const activationUrl = bot?.activationUrl || FEEDBACK_ACTIVATION_URL;
        if (!activationUrl) { pushBot(tBot('circle.feedback.activation_failed', { error: 'no activation URL', defaultValue: 'Activatie mislukt: geen activation-URL ingesteld.' })); return; }
        const pods = await activateMobileFeedback({ session, activationUrl, projectId: bot.projectId, code: bot.code, podRef: bot.podRef });
        if (cancelled) return;
        if (pods.podRef && pods.podRef !== bot.podRef && store) { try { await store.add({ ...bot, podRef: pods.podRef }); } catch { /* persist best-effort */ } }
        podsRef.current = pods;
        setPodsReady(true);
      } catch (e) {
        if (!cancelled) pushBot(`⚠ ${e?.message ?? e}`);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activation is one-shot per thread; tBot/pushBot are stable
  }, [session, bot, store, threadId]);

  // (B) Build the surface in the chosen language, reusing the cached pods (NO re-activation), then poll the
  // lead's /control/ round. Re-runs when botLang changes → rebuild the bot + re-start the thread in the new
  // language (fresh /help). Gated so a spurious re-render with the SAME lang doesn't rebuild.
  useEffect(() => {
    if (!podsReady || !botLang || activatedLangRef.current === botLang) return undefined;
    activatedLangRef.current = botLang;
    const pods = podsRef.current;
    let cancelled = false;
    setMessages([]); setEditing(null);
    (async () => {
      setBusy(true);
      try {
        const surface = createFeedbackSurface({
          projectId: bot.projectId,   // bind the dispatcher to the activation project (verify-round match)
          lang: botLang,              // the participant's chosen bot language (drives text + cards + pipeline)
          llmBaseURL: FEEDBACK_LLM_BASEURL,
          llmModel: FEEDBACK_LLM_MODEL,
          pod: pods.ownPod,
          centralPod: pods.centralPod,
          controlStore: pods.controlStore,
          // a review renders as editable per-point CARDS (kind:'review'+points); everything else as a bubble.
          emit: ({ text, buttons, kind, points, labels }) => {
            if (kind === 'review' && Array.isArray(points)) {
              setEditing(null);
              setMessages((prev) => [...prev, { id: mkId(), origin: 'bot', kind: 'review', intro: String(text ?? ''), points, labels }]);
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
  }, [podsReady, botLang, threadId, bot, pushBot]);

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
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]} testID="feedback-thread-screen">
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="feedback-thread-back">
          <Text style={styles.back}>{tBot('circle.contacts.back')}</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{tBot('circle.contacts.thread_title', { name })}</Text>
        <View style={styles.langToggle}>
          {['nl', 'en'].map((lg) => (
            <Pressable
              key={lg}
              onPress={() => changeLang(lg)}
              style={[styles.langBtn, botLang === lg && styles.langBtnActive]}
              accessibilityRole="button"
              testID={`feedback-lang-${lg}`}
            >
              <Text style={[styles.langBtnText, botLang === lg && styles.langBtnTextActive]}>{lg.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.log}
        contentContainerStyle={{ paddingVertical: 8, gap: 8 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd?.({ animated: true })}
      >
        {messages.map((m) => {
          if (m.kind === 'review') {
            // prefer the labels the BOT shipped (in its own language); fall back to the app locale.
            const L = (k, dv) => (m.labels && m.labels[k]) || t(`circle.feedback.${k}`, { defaultValue: dv }, botLang);
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
                              <Text style={styles.cardBtnMutedText}>{L('cancel_edit', 'Annuleer')}</Text>
                            </Pressable>
                            <Pressable style={styles.cardBtn} onPress={saveEdit} testID={`feedback-card-save-${p.id}`}>
                              <Text style={styles.cardBtnText}>{L('save_edit', 'Opslaan')}</Text>
                            </Pressable>
                          </View>
                        </>
                      ) : (
                        <>
                          <Pressable onPress={() => startEdit(m.id, p)}>
                            <Text style={styles.cardText}>
                              {p.text}{p.edited ? ` ${L('edited', '(aangepast)')}` : ''}
                            </Text>
                          </Pressable>
                          {changed ? (
                            <View style={styles.origRow}>
                              <Text style={styles.origLabel}>{L('original', 'origineel')}</Text>
                              <Text style={styles.origText}>{p.raw}</Text>
                            </View>
                          ) : null}
                          <View style={styles.cardBtns}>
                            <Pressable style={styles.cardBtnMuted} onPress={() => startEdit(m.id, p)} testID={`feedback-card-edit-${p.id}`}>
                              <Text style={styles.cardBtnMutedText}>✏</Text>
                            </Pressable>
                            <Pressable style={styles.cardBtn} onPress={() => tapControl(`fp:consent:${p.id}`)}>
                              <Text style={styles.cardBtnText}>{L('send_one', 'Verstuur')}</Text>
                            </Pressable>
                          </View>
                        </>
                      )}
                    </View>
                  );
                })}
                <View style={styles.reviewFooter}>
                  <Pressable style={styles.cardBtn} onPress={() => tapControl('fp:consent:all')}>
                    <Text style={styles.cardBtnText}>{L('send_all', 'Alles versturen')}</Text>
                  </Pressable>
                  <Pressable style={styles.cardBtnMuted} onPress={() => tapControl('fp:cancel')}>
                    <Text style={styles.cardBtnMutedText}>{L('send_none', 'Niets versturen')}</Text>
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
        {busy && <Text style={styles.sending}>{tBot('circle.contacts.thinking', { defaultValue: 'Bezig…' })}</Text>}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={tBot('circle.contacts.composer', { name })}
          placeholderTextColor={theme.color.inkSoft}
          autoCapitalize="none"
          onSubmitEditing={onSend}
          testID="feedback-thread-input"
        />
        <Pressable style={styles.send} onPress={onSend} accessibilityRole="button" testID="feedback-thread-send">
          <Text style={styles.sendText}>{tBot('circle.contacts.send')}</Text>
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  back: { fontSize: 13, color: theme.color.inkSoft },
  title: { fontFamily: theme.font.serif, fontSize: 18, fontWeight: '600', color: theme.color.ink, flexShrink: 1 },
  langToggle: { flexDirection: 'row', marginLeft: 'auto', borderWidth: 1, borderColor: theme.color.line, borderRadius: 10, overflow: 'hidden' },
  langBtn: { paddingVertical: 4, paddingHorizontal: 10 },
  langBtnActive: { backgroundColor: theme.color.accent },
  langBtnText: { fontSize: 12, fontWeight: '700', color: theme.color.inkSoft },
  langBtnTextActive: { color: theme.color.white },
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

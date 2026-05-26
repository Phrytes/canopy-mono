/**
 * Chat screen.
 *
 * #253 step 1 — TextInput + message list wired through the canonical
 * canopy-chat web pipeline (parseInput → resolveDispatch → runDispatch
 * → renderReply).  Slash commands and unknown free-text both flow
 * through here; the SlashFAB shares the same submitInput handler so
 * the two surfaces stay in lockstep.
 *
 * What this slice DOES not yet do (later #253 sub-steps):
 *   - render `list` replies with inline keyboard buttons (step 2)
 *   - thread sidebar / multi-thread switch (step 5)
 *   - inline action buttons in reply bubbles ([Help with] etc.) (step 4)
 *   - free-text LLM routing (later — web only has slash today too)
 *
 * No hardcoded strings ([[no-hardcoded-strings]]) — every label
 * goes through `t()`.
 */
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';

import {
  parseInput, resolveDispatch, runDispatch, renderReply,
} from '@canopy-app/canopy-chat';

import { bootAgentBundle } from '../core/agentBundle.js';
import { buildNavModels }  from '../core/navModel.js';
import { dlog }            from '../core/devLog.js';
import { t }               from '../core/localisation.js';
import {
  refreshList, snapshotSourceDispatch,
} from '../core/refreshList.js';
import SlashFAB            from '../rn/SlashFAB.js';

// Stable counter for synthetic message IDs (each round-trip = 2 ids).
let nextMessageId = 1;
const mkId = () => `m${nextMessageId++}`;

export default function ChatScreen() {
  const [bootState, setBootState] = useState({ kind: 'loading' });
  const [navModels, setNavModels] = useState([]);
  const [messages,  setMessages]  = useState([]);   // {id, role:'user'|'bot', text?, rendered?}
  const [input,     setInput]     = useState('');
  const [busy,      setBusy]      = useState(false);
  const [debugOpen, setDebugOpen] = useState(false); // collapse the 6 boot boxes
  const scrollRef   = useRef(null);
  // messagesRef stays in sync with `messages` so async handlers
  // (button taps fire-and-forget) can look up the originating bubble
  // without re-creating the callback on every state change.
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    (async () => {
      try {
        dlog.boot('booting agent bundle');
        const bundle = await bootAgentBundle();
        dlog.boot('bundle ready', {
          transport:   bundle.transport,
          appOrigins:  [...bundle.catalog.appOrigins],
          opCount:     bundle.catalog.opsById?.size ?? 0,
        });
        setNavModels(buildNavModels());
        setBootState({ kind: 'ready', bundle });
      } catch (err) {
        dlog.warn('boot failed', err?.message ?? err);
        setBootState({ kind: 'error', message: err?.message ?? String(err) });
      }
    })();
  }, []);

  // Auto-scroll on every new message.
  useEffect(() => {
    if (messages.length === 0) return;
    // RAF avoids a layout race on the freshly-appended bubble.
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd?.({ animated: true }));
  }, [messages]);

  /**
   * Run a dispatch through the pipeline + append a user/bot bubble pair.
   * Both the text-input path and the row-button-tap path funnel here so
   * the bubble timeline + error handling stays in lockstep.
   *
   * @param {object} args
   * @param {object} args.dispatch    — already-resolved dispatch shape (kind: 'ready' | 'unknown' | 'error')
   * @param {string} args.userText    — text to show in the user-bubble
   */
  const dispatchAndAppend = useCallback(async ({ dispatch, userText, sourceDispatch }) => {
    if (bootState.kind !== 'ready') return;
    const userMsgId = mkId();
    const botMsgId  = mkId();
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', text: userText },
      { id: botMsgId,  role: 'bot',  pending: true },
    ]);
    setBusy(true);

    try {
      const catalog = bootState.bundle.catalog;
      dlog.dispatch('resolved', {
        kind:      dispatch.kind,
        opId:      dispatch.opId,
        appOrigin: dispatch.appOrigin,
        args:      dispatch.args,
      });
      let rendered;
      if (dispatch.kind === 'ready') {
        // canopy-chat-host ops (/help, /threads, /settings, /relay,
        // /holiday-mode, /commands, /logs, /debug-dump, …) are handled
        // on web by `localBuiltins`, not by the agent.  The proper RN
        // port lands in a later #253 sub-step; for now short-circuit
        // with a clear message so the user sees what's going on
        // instead of a confusing "unknown appOrigin" from realAgent.
        if (dispatch.appOrigin === 'canopy-chat') {
          rendered = {
            kind: 'text',
            messageId: botMsgId,
            threadId: null,
            lifecycleState: 'closed',
            text: t('chat.canopy_chat_op_pending', { opId: dispatch.opId }),
          };
        } else {
          const reply = await runDispatch(dispatch, bootState.bundle.callSkill);
          // 2026-05-26 — pass the localiser + per-app manifest lookup
          // through so list bubbles get inline-keyboard buttons + the
          // per-row staleness badge renders the natural-language hint
          // (otherwise `sync.row_ago` leaks).  See test/chatRender.test.js
          // for the regression that pins this.
          rendered = renderReply(reply, {
            t,
            appOrigin:         dispatch.appOrigin,
            manifestsByOrigin: bootState.bundle.manifestsByOrigin,
          });
        }
      } else if (dispatch.kind === 'unknown') {
        rendered = {
          kind: 'error',
          messageId: botMsgId,
          threadId: null,
          lifecycleState: 'closed',
          error: { code: 'unknown-input', message: t('chat.unknown_input') },
          text: t('chat.unknown_input'),
        };
      } else {
        rendered = {
          kind: 'error',
          messageId: botMsgId,
          threadId: null,
          lifecycleState: 'closed',
          error: { code: dispatch.code ?? 'dispatch-error', message: dispatch.message ?? '' },
          text: dispatch.message ?? t('chat.dispatch_error'),
        };
      }

      dlog.render('rendered', {
        kind:        rendered.kind,
        itemCount:   rendered.items?.length ?? 0,
        buttonCount: (rendered.items ?? [])
          .reduce((n, it) => n + (it.buttons?.length ?? 0), 0),
      });

      // Remember the source dispatch on list bubbles so step-3
      // state-morphing can re-run it after a row-tap.  For non-list
      // bubbles we keep null — refreshList has no work to do.
      const trackedSource = (rendered.kind === 'list' && sourceDispatch)
        ? sourceDispatch
        : null;
      setMessages((prev) => prev.map((m) =>
        m.id === botMsgId
          ? { ...m, pending: false, rendered, sourceDispatch: trackedSource }
          : m,
      ));
    } catch (err) {
      dlog.warn('dispatch threw', err?.message ?? err);
      setMessages((prev) => prev.map((m) =>
        m.id === botMsgId
          ? {
              ...m,
              pending: false,
              rendered: {
                kind: 'error',
                messageId: botMsgId,
                threadId: null,
                lifecycleState: 'closed',
                error: { code: 'thrown', message: err?.message ?? String(err) },
                text: err?.message ?? String(err),
              },
            }
          : m,
      ));
    } finally {
      setBusy(false);
    }
  }, [bootState]);

  /** Bottom TextInput + SlashFAB path — parse free text then dispatch. */
  const submitInput = useCallback(async (rawInput) => {
    if (bootState.kind !== 'ready') return;
    const text = String(rawInput ?? '').trim();
    if (!text) return;
    const catalog  = bootState.bundle.catalog;
    const parsed   = parseInput(text, catalog);
    const dispatch = resolveDispatch(parsed, catalog);
    // sourceDispatch == dispatch when this is a slash that lists —
    // the bubble can re-run itself for state-morphing (#253 step 3).
    await dispatchAndAppend({
      dispatch,
      userText:       text,
      sourceDispatch: dispatch.kind === 'ready' ? snapshotSourceDispatch(dispatch) : null,
    });
  }, [bootState, dispatchAndAppend]);

  /**
   * Row-button-tap path (#253 step 2) — synthesise a slash-equivalent
   * parse so the row button drives the same dispatch pipeline.
   * Mirrors `apps/canopy-chat/web/main.js`'s `onButtonTap` minus the
   * web-only special cases (respondToItem DM spawn, startDm, demo-*,
   * downloadFile blob trigger, state-morphing refresh).  Those land
   * in later #253 sub-steps.
   */
  const handleButtonTap = useCallback(async ({ opId, itemId, buttonLabel, originMessageId }) => {
    if (bootState.kind !== 'ready') return;
    dlog.button('tap', { opId, itemId, buttonLabel, originMessageId });
    const catalog = bootState.bundle.catalog;
    const entry = catalog.opsById?.get(opId);
    if (!entry) {
      // No-op: catalog doesn't know this op.  Show as error.
      await dispatchAndAppend({
        dispatch: {
          kind: 'error',
          code: 'unknown-op',
          message: t('chat.dispatch_error'),
        },
        userText: buttonLabel,
      });
      return;
    }
    // Mirror web: bind itemId to the first required string/enum param,
    // fall back to `id`.
    const firstReq = (entry.op?.params ?? []).find(
      (p) => p?.required && (p.kind === 'string' || p.kind === 'enum'),
    );
    const args = firstReq ? { [firstReq.name]: itemId } : { id: itemId };
    const parse = {
      kind: 'slash', opId, args, threadId: null,
      command: '(button)', body: itemId,
    };
    const dispatch = resolveDispatch(parse, catalog);
    await dispatchAndAppend({
      dispatch,
      userText: t('chat.button_tap', { label: buttonLabel, item: itemId }),
    });

    // #253 step 3 — after a successful row-action dispatch, refresh
    // the ORIGINATING list bubble in place so its rows re-evaluate
    // against the post-dispatch item state.  Mirrors web's
    // refreshListMessageInPlace.  No-op when the origin bubble can't
    // be re-rendered (origin gone, source dispatch absent, refresh
    // throws — caller intentionally swallows so the UI stays stable).
    if (originMessageId) {
      const origin = messagesRef.current.find((m) => m.id === originMessageId);
      const sourceDispatch = origin?.sourceDispatch;
      if (sourceDispatch) {
        const refreshed = await refreshList({
          sourceDispatch,
          catalog,
          manifestsByOrigin: bootState.bundle.manifestsByOrigin,
          callSkill:         bootState.bundle.callSkill,
          t,
        });
        if (refreshed) {
          setMessages((prev) => prev.map((m) =>
            m.id === originMessageId ? { ...m, rendered: refreshed } : m,
          ));
        }
      }
    }
  }, [bootState, dispatchAndAppend]);

  const onSendPress = useCallback(async () => {
    const text = input;
    setInput('');
    await submitInput(text);
  }, [input, submitInput]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="chat-screen"
    >
      {/* Boot status + (collapsible) debug info above the messages. */}
      <View style={styles.header}>
        <Text style={styles.title}>{t('app.name')}</Text>
        <Text style={styles.tagline}>{t('app.tagline')}</Text>
        {bootState.kind === 'loading' && (
          <Text style={styles.status}>{t('boot.loading')}</Text>
        )}
        {bootState.kind === 'error' && (
          <Text style={styles.error}>
            {t('boot.boot_failed', { message: bootState.message })}
          </Text>
        )}
        {bootState.kind === 'ready' && (
          <TouchableOpacity
            onPress={() => setDebugOpen((v) => !v)}
            accessibilityRole="button"
            testID="chat-debug-toggle"
          >
            <Text style={styles.status} testID="chat-header-status">
              {t('boot.agents_ready')} — {navModels.length} apps
              {debugOpen ? ' ▼' : ' ▶'}
            </Text>
          </TouchableOpacity>
        )}
        {bootState.kind === 'ready' && debugOpen && (
          <View testID="chat-debug-list">
            {navModels.map(({ appOrigin, nav }) => (
              <View
                key={appOrigin}
                style={styles.appBlock}
                testID={`chat-app-row-${appOrigin}`}
              >
                <Text style={styles.appName}>{appOrigin}</Text>
                <Text style={styles.appMeta}>
                  {(nav.sections ?? []).length} sections,{' '}
                  {(nav.globals ?? []).length} globals
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Message list. */}
      <ScrollView
        ref={scrollRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
      >
        {messages.length === 0 ? (
          <Text style={styles.emptyState}>{t('chat.no_messages_yet')}</Text>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} onButtonTap={handleButtonTap} />
          ))
        )}
      </ScrollView>

      {/* Bottom input bar. */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={t('chat.placeholder')}
          editable={bootState.kind === 'ready' && !busy}
          onSubmitEditing={onSendPress}
          returnKeyType="send"
          blurOnSubmit={false}
          testID="chat-input"
        />
        <TouchableOpacity
          onPress={onSendPress}
          disabled={bootState.kind !== 'ready' || busy || !input.trim()}
          style={[
            styles.sendBtn,
            (bootState.kind !== 'ready' || busy || !input.trim()) && styles.sendBtnDisabled,
          ]}
          accessibilityRole="button"
          testID="chat-send"
        >
          <Text style={styles.sendBtnText}>{t('chat.send')}</Text>
        </TouchableOpacity>
      </View>

      {/* SlashFAB — shares submitInput so behaviors stay in lockstep. */}
      {bootState.kind === 'ready' && (
        <SlashFAB
          catalog={bootState.bundle.catalog}
          onDispatch={submitInput}
        />
      )}
    </KeyboardAvoidingView>
  );
}

/* ── message bubble ─────────────────────────────────────────────── */

function MessageBubble({ msg, onButtonTap }) {
  if (msg.role === 'user') {
    return (
      <View style={[styles.bubble, styles.bubbleUser]} testID={`bubble-user-${msg.id}`}>
        <Text style={[styles.bubbleText, styles.bubbleUserText]}>{msg.text}</Text>
      </View>
    );
  }

  // Bot bubble.
  if (msg.pending) {
    return (
      <View style={[styles.bubble, styles.bubbleBot]}>
        <Text style={[styles.bubbleText, styles.bubblePending]}>
          {t('chat.thinking')}
        </Text>
      </View>
    );
  }

  const r = msg.rendered ?? {};
  if (r.kind === 'error') {
    return (
      <View style={[styles.bubble, styles.bubbleError]}>
        <Text style={styles.bubbleErrorText}>
          {r.text ?? r.error?.message ?? t('chat.dispatch_error')}
        </Text>
      </View>
    );
  }
  if (r.kind === 'list') {
    const items   = r.items ?? [];
    const enabled = r.lifecycleState !== 'disabled' && typeof onButtonTap === 'function';
    return (
      <View
        style={[styles.bubble, styles.bubbleBot, styles.bubbleList]}
        testID={`bubble-bot-list-${msg.id}`}
      >
        {items.length === 0 ? (
          <Text style={styles.bubbleText}>{t('chat.list_empty')}</Text>
        ) : (
          items.map((item) => (
            <ListItemRow
              key={item.id}
              item={item}
              enabled={enabled}
              onButtonTap={onButtonTap}
              originMessageId={msg.id}
            />
          ))
        )}
      </View>
    );
  }
  // kind: 'text' or unknown shape — fall back to text rendering.
  return (
    <View style={[styles.bubble, styles.bubbleBot]}>
      <Text style={styles.bubbleText}>{r.text ?? ''}</Text>
    </View>
  );
}

/** A single list-bubble row: label + staleness hint + inline keyboard. */
function ListItemRow({ item, enabled, onButtonTap, originMessageId }) {
  const buttons = Array.isArray(item.buttons) ? item.buttons : [];
  return (
    <View style={styles.listRow} testID={`list-row-${item.id}`}>
      <Text style={styles.listRowLabel}>{item.label ?? item.id}</Text>
      {typeof item.staleHint === 'string' && item.staleHint !== '' && (
        <Text style={styles.listRowStale}>{item.staleHint}</Text>
      )}
      {buttons.length > 0 && (
        <View style={styles.listRowButtons}>
          {buttons.map((btn, i) => {
            // callbackData is `<opId>:<itemId>` (web convention from
            // domAdapter.js — kept in lockstep here so per-row
            // appliesTo-gated buttons survive cross-surface).
            const [opId, ...rest] = String(btn.callbackData ?? '').split(':');
            const itemId = rest.join(':');
            const onPress = () => onButtonTap?.({
              opId, itemId,
              buttonLabel: btn.label,
              originMessageId,
            });
            return (
              <TouchableOpacity
                key={`${btn.callbackData}-${i}`}
                onPress={onPress}
                disabled={!enabled}
                style={[
                  styles.listRowBtn,
                  !enabled && styles.listRowBtnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={btn.label}
                testID={`list-row-btn-${opId}-${itemId}`}
              >
                <Text
                  style={[
                    styles.listRowBtnText,
                    !enabled && styles.listRowBtnTextDisabled,
                  ]}
                >
                  {btn.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#fff' },
  header:     { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  title:      { fontSize: 22, fontWeight: '700' },
  tagline:    { fontSize: 13, color: '#666' },
  status:     { fontSize: 13, marginTop: 8 },
  error:      { fontSize: 13, marginTop: 8, color: '#b00' },
  appBlock:   { marginTop: 8, padding: 8, backgroundColor: '#f7f7f7', borderRadius: 6 },
  appName:    { fontSize: 14, fontWeight: '600' },
  appMeta:    { fontSize: 11, color: '#666', marginTop: 2 },

  messageList:        { flex: 1 },
  messageListContent: { padding: 12, gap: 8 },
  emptyState:         { textAlign: 'center', color: '#888', marginTop: 24, fontSize: 13 },

  bubble:           { maxWidth: '85%', padding: 10, borderRadius: 12, marginBottom: 4 },
  bubbleUser:       { backgroundColor: '#1e88e5', alignSelf: 'flex-end' },
  bubbleBot:        { backgroundColor: '#f0f0f0', alignSelf: 'flex-start' },
  bubbleError:      { backgroundColor: '#fde8e8', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#f5b5b5' },
  bubbleText:       { fontSize: 14, color: '#222' },
  bubblePending:    { fontStyle: 'italic', color: '#666' },
  bubbleErrorText:  { fontSize: 14, color: '#b00' },
  bubbleList:       { paddingVertical: 6 },

  listRow:         { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  listRowLabel:    { fontSize: 14, color: '#222' },
  listRowStale:    { fontSize: 11, color: '#888', marginTop: 2 },
  listRowButtons:  { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, gap: 6 },
  listRowBtn:      { backgroundColor: '#1e88e5', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  listRowBtnDisabled: { backgroundColor: '#ccc' },
  listRowBtnText:  { color: '#fff', fontSize: 12, fontWeight: '600' },
  listRowBtnTextDisabled: { color: '#666' },

  inputBar:        { flexDirection: 'row', padding: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd', gap: 8, alignItems: 'center' },
  input:           { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14 },
  sendBtn:         { backgroundColor: '#1e88e5', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  sendBtnDisabled: { backgroundColor: '#bbb' },
  sendBtnText:     { color: '#fff', fontWeight: '600' },
});

/* Used by the user-bubble.  Define a stylesheet override here so the
 * bubbleText style stays neutral and the white-on-blue only kicks in
 * inside the user bubble.  RN cascades when style is an array. */
styles.bubbleUserText = { ...styles.bubbleText, color: '#fff' };

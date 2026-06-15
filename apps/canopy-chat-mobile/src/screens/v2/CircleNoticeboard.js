/**
 * canopy-chat-mobile v2 — circle noticeboard / prikbord (RN, S1 #1 parity).
 *
 * RN mirror of web's `circleNoticeboard.js`: the buurt noticeboard inside a
 * circle's PRIKBORD tab — an ask/offer/lend composer and the open-post list with
 * per-row actions. Self-contained: loads `listOpen` and dispatches `postRequest`/
 * `respondToItem`/`cancelRequest`/`reportPost`/`markReturned` via the injected
 * `callSkill` (the same already-wired stoop ops). Shows the shared buurt's posts
 * (one stoop agent today); per-circle scoping arrives with the pod foundation.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { t } from '../../core/localisation.js';
import { theme } from './theme.js';

const INTENTS = ['ask', 'offer', 'lend'];

export default function CircleNoticeboard({ callSkill }) {
  const [posts, setPosts] = useState([]);
  const [intent, setIntent] = useState('ask');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [myWebid, setMyWebid] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [dueText, setDueText] = useState('');   // S3 #4 — lend return-by date (YYYY-MM-DD)
  const [assigningTo, setAssigningTo] = useState(null);   // S3 #4 — lender assigns a borrower
  const [assignText, setAssignText] = useState('');

  const reload = useCallback(async () => {
    if (typeof callSkill !== 'function') return;
    let who = myWebid;
    if (who == null) { try { const r = await callSkill('stoop', 'whoAmI', {}); who = r?.webid ?? r?.webId ?? ''; } catch { who = ''; } setMyWebid(who); }
    try {
      const res = await callSkill('stoop', 'listOpen', {});
      const items = Array.isArray(res?.items) ? res.items : [];
      setPosts(items.map((it) => ({
        id: it.id, text: it.text ?? it.label ?? '', type: it.type ?? it.intent ?? 'ask',
        addedBy: it.addedBy, mine: !!(who && it.addedBy === who),
      })));
    } catch { setPosts([]); }
  }, [callSkill, myWebid]);

  useEffect(() => { reload(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const submitPost = useCallback(async () => {
    const body = text.trim();
    if (!body || typeof callSkill !== 'function') return;
    const dueAt = intent === 'lend' && dueText ? Date.parse(dueText) : undefined;
    setText(''); setDueText(''); setError(false); setBusy(true);
    try { await callSkill('stoop', 'postRequest', { intent, text: body, ...(Number.isFinite(dueAt) ? { dueAt } : {}) }); }
    catch { setError(true); }
    setBusy(false);
    reload();
  }, [text, intent, dueText, callSkill, reload]);

  const runAction = useCallback(async (action, post) => {
    try {
      if (action === 'respond') { setReplyingTo(post.id); setReplyText(''); return; }
      if (action === 'assign') { setAssigningTo(post.id); setAssignText(''); return; }
      if (action === 'cancel') await callSkill('stoop', 'cancelRequest', { requestId: post.id });
      else if (action === 'report') await callSkill('stoop', 'reportPost', { itemId: post.id });
      else if (action === 'markReturned') await callSkill('stoop', 'markReturned', { requestId: post.id });
      else if (action === 'mute' && post.addedBy) await callSkill('stoop', 'mutePeer', { peerWebid: post.addedBy });
    } catch { /* reload reflects the real state */ }
    reload();
  }, [callSkill, reload]);

  const submitReply = useCallback(async (post) => {
    const body = replyText.trim();
    if (!body) { setReplyingTo(null); return; }
    try { await callSkill('stoop', 'respondToItem', { itemId: post.id, body }); } catch { /* */ }
    setReplyingTo(null); setReplyText('');
    reload();
  }, [replyText, callSkill, reload]);

  const submitAssign = useCallback(async (post) => {
    const borrowerWebid = assignText.trim();
    if (!borrowerWebid) { setAssigningTo(null); return; }
    try { await callSkill('stoop', 'assignLend', { itemId: post.id, borrowerWebid }); } catch { /* */ }
    setAssigningTo(null); setAssignText('');
    reload();
  }, [assignText, callSkill, reload]);

  return (
    <View style={styles.wrap} testID="circle-noticeboard">
      <View style={styles.intents}>
        {INTENTS.map((it) => (
          <Pressable key={it} style={[styles.intent, it === intent && styles.intentActive]} onPress={() => setIntent(it)} testID={`nb-intent-${it}`}>
            <Text style={[styles.intentText, it === intent && styles.intentTextActive]}>{t(`circle.noticeboard.intent.${it}`)}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.composerRow}>
        <TextInput
          style={styles.input} value={text} onChangeText={setText}
          placeholder={t(`circle.noticeboard.placeholder.${intent}`)} placeholderTextColor={theme.color.inkSoft}
          onSubmitEditing={submitPost} testID="nb-input"
        />
        <Pressable style={styles.post} onPress={submitPost} testID="nb-post"><Text style={styles.postText}>{t('circle.noticeboard.post')}</Text></Pressable>
      </View>
      {intent === 'lend' && (
        <View style={styles.dueRow}>
          <Text style={styles.dueLabel}>{t('circle.noticeboard.due')}</Text>
          <TextInput style={styles.dueInput} value={dueText} onChangeText={setDueText} placeholder="YYYY-MM-DD" placeholderTextColor={theme.color.inkSoft} autoCapitalize="none" testID="nb-due" />
        </View>
      )}
      {busy && <Text style={styles.busy}>{t('circle.noticeboard.posting')}</Text>}
      {error && <Text style={styles.error}>{t('circle.noticeboard.post_failed')}</Text>}

      {posts.length === 0 ? (
        <Text style={styles.empty}>{t('circle.noticeboard.empty')}</Text>
      ) : posts.map((p) => (
        <View key={p.id} style={styles.postRow} testID={`nb-post-${p.id}`}>
          <View style={[styles.badge, styles[`badge_${p.type}`] || styles.badge_ask]}>
            <Text style={styles.badgeText}>{t(`circle.noticeboard.intent.${p.type || 'ask'}`)}</Text>
          </View>
          <Text style={styles.postText2}>{p.text}</Text>
          <View style={styles.actions}>
            {!p.mine && <Chip label={t('circle.noticeboard.action.respond')} onPress={() => runAction('respond', p)} />}
            {p.type === 'lend' && p.mine && <Chip label={t('circle.noticeboard.action.assign')} onPress={() => runAction('assign', p)} />}
            {p.type === 'lend' && p.mine && <Chip label={t('circle.noticeboard.action.returned')} onPress={() => runAction('markReturned', p)} />}
            {p.mine && <Chip label={t('circle.noticeboard.action.cancel')} onPress={() => runAction('cancel', p)} />}
            {!p.mine && <Chip label={t('circle.noticeboard.action.report')} muted onPress={() => runAction('report', p)} />}
            {!p.mine && <Chip label={t('circle.noticeboard.action.mute')} muted onPress={() => runAction('mute', p)} />}
          </View>
          {replyingTo === p.id && (
            <View style={styles.replyRow}>
              <TextInput style={styles.replyInput} value={replyText} onChangeText={setReplyText} placeholder={t('circle.noticeboard.respond_prompt')} placeholderTextColor={theme.color.inkSoft} onSubmitEditing={() => submitReply(p)} testID={`nb-reply-${p.id}`} autoFocus />
              <Pressable style={styles.post} onPress={() => submitReply(p)}><Text style={styles.postText}>{t('circle.contacts.send')}</Text></Pressable>
            </View>
          )}
          {assigningTo === p.id && (
            <View style={styles.replyRow}>
              <TextInput style={styles.replyInput} value={assignText} onChangeText={setAssignText} placeholder={t('circle.noticeboard.assign_prompt')} placeholderTextColor={theme.color.inkSoft} autoCapitalize="none" onSubmitEditing={() => submitAssign(p)} testID={`nb-assign-${p.id}`} autoFocus />
              <Pressable style={styles.post} onPress={() => submitAssign(p)}><Text style={styles.postText}>{t('circle.noticeboard.action.assign')}</Text></Pressable>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function Chip({ label, onPress, muted }) {
  return (
    <Pressable style={[styles.chip, muted && styles.chipMuted]} onPress={onPress}>
      <Text style={[styles.chipText, muted && styles.chipTextMuted]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, paddingVertical: 4 },
  intents: { flexDirection: 'row', gap: 6 },
  intent: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.color.line },
  intentActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  intentText: { fontSize: 13, fontWeight: '600', color: theme.color.inkSoft },
  intentTextActive: { color: theme.color.white },
  composerRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, fontSize: 14, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  post: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: theme.radius.md, backgroundColor: theme.color.accent, justifyContent: 'center' },
  postText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  busy: { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic' },
  error: { fontSize: 13, color: '#b3261e' },
  empty: { fontSize: 14, color: theme.color.inkSoft, paddingVertical: 12 },
  postRow: { padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, backgroundColor: theme.color.white, gap: 4 },
  badge: { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  badge_ask: { backgroundColor: '#fdeede' },
  badge_offer: { backgroundColor: '#e6f0e9' },
  badge_lend: { backgroundColor: '#e8eef6' },
  badgeText: { fontSize: 11, fontWeight: '700', color: theme.color.ink, textTransform: 'uppercase' },
  postText2: { fontSize: 14, color: theme.color.ink, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.color.accent },
  chipMuted: { borderColor: theme.color.line },
  chipText: { fontSize: 12, fontWeight: '600', color: theme.color.accent },
  chipTextMuted: { color: theme.color.inkSoft },
  replyRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  replyInput: { flex: 1, fontSize: 14, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dueLabel: { fontSize: 13, color: theme.color.inkSoft },
  dueInput: { flex: 1, fontSize: 14, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
});

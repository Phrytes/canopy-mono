/**
 * canopy-chat-mobile v2 — "My data" screen (RN, S5 parity).
 *
 * RN mirror of web's circleMyData: where your data lives (getDataLocation +
 * podSignInStatus), the getPrivacyNotice disclosure, a getMetrics usage snapshot,
 * and the S5 key-management actions (back up · reveal recovery phrase · restore).
 * Self-contained: loads + mutates via the injected stoop-capable `callSkill`.
 * The backup/restore flows reuse the existing RN wizard modals — no reimpl.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Modal, TextInput } from 'react-native';
import { t, lang, setLang } from '../../core/localisation.js';
import { theme } from './theme.js';
import { surfacePrefStore } from '../../core/surfacePrefStore.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createRelayPrefStore, asyncStorageRelayIo } from '../../../../canopy-chat/src/v2/relayPref.js';
import UserLlmSettings from './UserLlmSettings.js';
import EncryptedBackupWizardModal from '../../../../canopy-chat/src/rn/wizards/encryptedBackupWizardModal.js';
import RestoreFromMnemonicWizardModal from '../../../../canopy-chat/src/rn/wizards/restoreFromMnemonicWizardModal.js';
import { enableNativePush, disableNativePush, getNativePushState } from '../../v2/nativePush.js';

const CHAT_AI_KEY = { on: 'chat_ai_on', 'circle-off': 'chat_ai_circle_off', 'no-llm': 'chat_ai_no_llm', 'no-provider': 'chat_ai_no_provider' };

export default function CircleMyDataScreen({ callSkill, podAuth, onBack, chatAi, userLlm, onSaveUserLlm, validateUserLlm }) {
  const [dataLocation, setDataLocation] = useState({});
  const [podStatus, setPodStatus] = useState({});
  // cluster J — pod sign-in entry (the v2 UI had none; sign-in was stranded in the hidden ChatScreen).
  const [issuer, setIssuer] = useState('https://login.inrupt.com');
  const [signingIn, setSigningIn] = useState(false);
  const [signInErr, setSignInErr] = useState('');
  const [privacy, setPrivacy] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [wizard, setWizard] = useState(null);          // 'backup' | 'restore' | null
  const [mnemonic, setMnemonic] = useState(null);      // { words } | null when closed
  const [push, setPush] = useState({ supported: false, granted: false });   // S6.6 native push
  const [surfacePref, setSurfacePref] = useState(surfacePrefStore.get());    // S6.C surface preference
  const setPref = useCallback((v) => { surfacePrefStore.set(v).then(() => setSurfacePref(v)).catch(() => {}); }, []);

  // In-app relay setting — point the no-server cross-device relay at a reachable server WITHOUT a rebuild
  // (web≡mobile via relayPref.js). agentBundle/hostOps read this at connect; applies on the next app open.
  const relayStore = React.useMemo(() => createRelayPrefStore(asyncStorageRelayIo(AsyncStorage)), []);
  const [relayInput, setRelayInput] = useState('');
  const [relayNote, setRelayNote] = useState('');
  useEffect(() => { relayStore.get().then(setRelayInput).catch(() => {}); }, [relayStore]);
  const saveRelay = useCallback(async () => {
    try {
      const saved = await relayStore.set(relayInput);
      setRelayInput(saved);
      setRelayNote(t('circle.mydata.relay_saved_reload', { url: saved || t('circle.mydata.relay_off') }));
    } catch (e) { setRelayNote(t('circle.mydata.relay_error', { msg: e?.message ?? '' })); }
  }, [relayStore, relayInput]);

  useEffect(() => { getNativePushState().then(setPush).catch(() => {}); }, []);
  const toggleNativePush = useCallback(async () => {
    if (push.granted) await disableNativePush({ callSkill });
    else await enableNativePush({ callSkill });
    setPush(await getNativePushState());
  }, [push.granted, callSkill]);

  const revealMnemonic = useCallback(async () => {
    let words = '';
    try {
      const res = await callSkill('stoop', 'getMnemonicOnce', {});
      if (res && !res.error) words = res.mnemonic ?? res.phrase ?? res.words ?? '';
    } catch { words = ''; }
    setMnemonic({ words: Array.isArray(words) ? words.join(' ') : String(words || '') });
  }, [callSkill]);

  const load = useCallback(async () => {
    if (typeof callSkill !== 'function') return;
    const [loc, status, priv, met] = await Promise.all([
      callSkill('stoop', 'getDataLocation', {}).catch(() => null),
      callSkill('stoop', 'podSignInStatus', {}).catch(() => null),
      callSkill('stoop', 'getPrivacyNotice', { lang: lang() }).catch(() => null),
      callSkill('stoop', 'getMetrics', {}).catch(() => null),
    ]);
    setDataLocation(loc ?? {});
    setPodStatus(status ?? {});
    setPrivacy(Array.isArray(priv?.sections) ? priv.sections : []);
    setMetrics((met?.snapshot && typeof met.snapshot === 'object') ? met.snapshot : {});
  }, [callSkill]);

  useEffect(() => { load(); }, [load]);

  const doSignIn = useCallback(async () => {
    if (!podAuth?.startSignIn) return;
    setSignInErr(''); setSigningIn(true);
    try { await podAuth.startSignIn({ issuer: issuer.trim() || undefined }); }
    catch (e) {
      // DCR/discovery race: the client_id (re)registers async on mount + after a stale-client purge; a tap
      // during that window throws CLIENT_ID_PENDING/DISCOVERY_PENDING ("registration not yet complete").
      // Wait briefly + retry once instead of surfacing the transient error.
      const msg = e?.message ?? String(e);
      if (['CLIENT_ID_PENDING', 'DISCOVERY_PENDING', 'REQUEST_PENDING'].includes(e?.code) || /not yet complete/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 1500));
        try { await podAuth.startSignIn({ issuer: issuer.trim() || undefined }); }
        catch (e2) { setSignInErr(e2?.message ?? String(e2)); }
      } else { setSignInErr(msg); }
    }
    finally { setSigningIn(false); }
    load().catch(() => {});   // refresh pod status separately — its failure must not look like a sign-in error
  }, [podAuth, issuer, load]);
  const doSignOut = useCallback(async () => {
    if (!podAuth?.signOut) return;
    try { await podAuth.signOut(); await load(); } catch { /* best-effort */ }
  }, [podAuth, load]);

  // Status from the actual session (podAuth), not just the stoop skill: getRawSessionInfo().webId is set
  // whenever a session exists — including after the short access token expires (still refreshable) — so the
  // "Me" screen doesn't lag back to "Local only" the way isAuthenticated()-based podSignInStatus does.
  const rawSession = podAuth?.getRawSessionInfo?.() ?? null;
  const podSignedIn = podStatus.signedIn || !!rawSession?.webId;
  const podWebid = podStatus.webid || rawSession?.webId || '';
  const relay = [dataLocation.relayOperator, dataLocation.relayUrl].filter(Boolean).join(' · ');
  const usage = Object.entries(metrics || {});

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} testID="circle-mydata">
      <View style={styles.header}>
        {typeof onBack === 'function' && <Pressable onPress={onBack} testID="mydata-back"><Text style={styles.back}>{t('circle.mydata.back')}</Text></Pressable>}
        <Text style={styles.title}>{t('circle.mydata.title')}</Text>
      </View>

      <Section title={t('circle.mydata.storage')}>
        <KV k={t('circle.mydata.pod')} v={podSignedIn ? t('circle.mydata.pod_signed_in', { webid: podWebid }) : t('circle.mydata.pod_local')} />
        {dataLocation.podRoot ? <KV k={t('circle.mydata.pod_root')} v={dataLocation.podRoot} /> : null}
        {relay ? <KV k={t('circle.mydata.relay')} v={relay} /> : null}

        {/* In-app relay setting — no-server cross-device sync, configurable without a rebuild. */}
        <View style={styles.relayEdit}>
          <TextInput
            style={styles.relayInput}
            value={relayInput}
            onChangeText={setRelayInput}
            placeholder={process.env.EXPO_PUBLIC_CIRCLE_RELAY_URL || 'ws://…:8787'}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            testID="relay-input"
          />
          <Pressable style={styles.relaySave} onPress={saveRelay} testID="relay-save">
            <Text style={styles.relaySaveText}>{t('circle.mydata.relay_save')}</Text>
          </Pressable>
        </View>
        {relayNote ? <Text style={styles.relayNote}>{relayNote}</Text> : null}
        <Text style={styles.relayHint}>{t('circle.mydata.relay_hint')}</Text>

        {/* cluster J — pod sign-in entry (the v2 UI had none). When signed out: pod provider + Connect. */}
        {podAuth && !podSignedIn && (
          <View style={styles.signin}>
            <TextInput
              style={styles.signinInput}
              value={issuer}
              onChangeText={setIssuer}
              placeholder={t('circle.mydata.pod_issuer')}
              placeholderTextColor={theme.color.inkSoft}
              autoCapitalize="none"
              autoCorrect={false}
              testID="mydata-pod-issuer"
            />
            <Pressable style={[styles.action, signingIn && styles.actionMuted]} onPress={doSignIn} disabled={signingIn} testID="mydata-pod-signin">
              <Text style={styles.actionLabel}>{signingIn ? t('circle.mydata.pod_connecting') : t('circle.mydata.pod_sign_in')}</Text>
            </Pressable>
            {signInErr ? <Text style={styles.signinErr}>{signInErr}</Text> : null}
          </View>
        )}
        {podAuth && podSignedIn && (
          <Pressable style={[styles.action, styles.actionMuted]} onPress={doSignOut} testID="mydata-pod-signout">
            <Text style={styles.actionMutedLabel}>{t('circle.mydata.pod_signout')}</Text>
          </Pressable>
        )}
      </Section>

      <Section title={t('circle.mydata.keys')}>
        <Pressable style={styles.action} onPress={() => setWizard('backup')} testID="mydata-backup">
          <Text style={styles.actionLabel}>{t('circle.mydata.backup')}</Text>
        </Pressable>
        <Pressable style={styles.action} onPress={revealMnemonic} testID="mydata-mnemonic">
          <Text style={styles.actionLabel}>{t('circle.mydata.view_mnemonic')}</Text>
        </Pressable>
        <Pressable style={[styles.action, styles.actionMuted]} onPress={() => setWizard('restore')} testID="mydata-restore">
          <Text style={styles.actionMutedLabel}>{t('circle.mydata.restore')}</Text>
        </Pressable>
      </Section>

      <Section title={t('circle.mydata.notifications')}>
        <Text style={styles.privacyBody}>
          {!push.supported ? t('circle.mydata.notif_unsupported')
            : push.granted ? t('circle.mydata.notif_on') : t('circle.mydata.notif_off')}
        </Text>
        {push.supported ? (
          <Pressable style={styles.action} onPress={toggleNativePush} testID="mydata-notif-toggle">
            <Text style={styles.actionLabel}>{push.granted ? t('circle.mydata.notif_disable') : t('circle.mydata.notif_enable')}</Text>
          </Pressable>
        ) : null}
      </Section>

      <Section title={t('circle.mydata.surface_pref')}>
        {['inline', 'screen', 'chat'].map((opt) => (
          <Pressable
            key={opt}
            style={[styles.action, opt === surfacePref && styles.actionActive]}
            onPress={() => setPref(opt)}
            testID={`mydata-pref-${opt}`}
          >
            <Text style={[styles.actionLabel, opt === surfacePref && styles.actionActiveLabel]}>
              {t(`circle.mydata.surface_pref_${opt}`)}
            </Text>
          </Pressable>
        ))}
        {/* S6.D — when "chat" is chosen, show whether AI is enriching it here. */}
        {surfacePref === 'chat' && chatAi?.reason ? (
          <Text style={styles.privacyBody}>
            {chatAi.enriched ? '✨ ' : ''}{t(`circle.mydata.${CHAT_AI_KEY[chatAi.reason] ?? 'chat_ai_no_provider'}`)}
          </Text>
        ) : null}
      </Section>

      {/* global app language (NL/EN) — a user preference, applies app-wide (web≡mobile). */}
      <Section title={t('circle.mydata.language')}>
        {['nl', 'en'].map((lg) => (
          <Pressable
            key={lg}
            style={[styles.action, lg === lang() && styles.actionActive]}
            onPress={() => setLang(lg)}
            testID={`mydata-lang-${lg}`}
          >
            <Text style={[styles.actionLabel, lg === lang() && styles.actionActiveLabel]}>{lg.toUpperCase()}</Text>
          </Pressable>
        ))}
      </Section>

      {typeof onSaveUserLlm === 'function' && (
        <Section title={t('circle.userLlm.title')}>
          <UserLlmSettings current={userLlm || {}} onSave={onSaveUserLlm} validate={validateUserLlm} />
        </Section>
      )}

      {privacy.length > 0 && (
        <Section title={t('circle.mydata.privacy')}>
          {privacy.map((s, i) => (
            <View key={s.key ?? i} style={styles.privacy}>
              <Text style={styles.privacyTitle}>{s.title}</Text>
              <Text style={styles.privacyBody}>{s.body}</Text>
            </View>
          ))}
        </Section>
      )}

      {usage.length > 0 && (
        <Section title={t('circle.mydata.usage')}>
          {usage.map(([k, v]) => <KV key={k} k={k} v={typeof v === 'object' ? JSON.stringify(v) : String(v)} />)}
        </Section>
      )}

      <EncryptedBackupWizardModal visible={wizard === 'backup'} callSkill={callSkill} t={t} onClose={() => setWizard(null)} onDispatched={() => {}} />
      <RestoreFromMnemonicWizardModal visible={wizard === 'restore'} callSkill={callSkill} t={t} onClose={() => setWizard(null)} onDispatched={() => {}} />

      {/* S5 — one-time recovery-phrase reveal (stoop getMnemonicOnce). */}
      <Modal visible={!!mnemonic} animationType="fade" transparent onRequestClose={() => setMnemonic(null)}>
        <Pressable style={styles.mBackdrop} onPress={() => setMnemonic(null)}>
          <Pressable style={styles.mCard} onPress={(e) => e.stopPropagation()} testID="mydata-mnemonic-reveal">
            <Text style={styles.mTitle}>{t('circle.mydata.mnemonic_title')}</Text>
            {mnemonic?.words
              ? (<>
                  <Text style={styles.mWarn}>{t('circle.mydata.mnemonic_warn')}</Text>
                  <Text style={styles.mWords} selectable>{mnemonic.words}</Text>
                </>)
              : (<Text style={styles.mWarn}>{t('circle.mydata.mnemonic_none')}</Text>)}
            <Pressable style={styles.action} onPress={() => setMnemonic(null)}>
              <Text style={styles.actionLabel}>{t('circle.mydata.close')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function KV({ k, v }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.k}>{k}</Text>
      <Text style={styles.v}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.color.paper },
  content: { padding: 16, gap: 16, paddingBottom: 80 },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  back: { fontSize: 13, color: theme.color.inkSoft },
  title: { fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink },
  section: { borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, padding: 12, gap: 8, backgroundColor: theme.color.paper },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, color: theme.color.inkSoft },
  kv: { flexDirection: 'row', gap: 10 },
  k: { flex: 0.35, fontSize: 13, color: theme.color.inkSoft },
  v: { flex: 1, fontSize: 13, color: theme.color.ink },
  privacy: { gap: 2 },
  privacyTitle: { fontSize: 13, fontWeight: '600', color: theme.color.ink },
  privacyBody: { fontSize: 13, color: theme.color.inkSoft, lineHeight: 18 },
  relayEdit: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  relayInput: { flex: 1, fontSize: 14, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  relaySave: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: theme.radius.md, backgroundColor: theme.color.terracotta },
  relaySaveText: { fontSize: 14, fontWeight: '600', color: theme.color.white },
  relayNote: { marginTop: 6, fontSize: 12, color: theme.color.ink },
  relayHint: { marginTop: 4, fontSize: 12, color: theme.color.inkMuted ?? theme.color.ink },
  signin: { marginTop: 10, gap: 8 },
  signinInput: { fontSize: 14, paddingVertical: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, color: theme.color.ink, backgroundColor: theme.color.white },
  signinErr: { fontSize: 12, color: '#b3261e' },
  action: { alignSelf: 'flex-start', borderWidth: 1, borderColor: theme.color.accent, borderRadius: theme.radius.md, paddingVertical: 8, paddingHorizontal: 14 },
  actionLabel: { fontSize: 13, fontWeight: '600', color: theme.color.accent },
  actionActive: { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  actionActiveLabel: { color: theme.color.white },
  actionMuted: { borderColor: theme.color.line },
  actionMutedLabel: { fontSize: 13, fontWeight: '600', color: theme.color.inkSoft },
  mBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  mCard: { backgroundColor: theme.color.paper, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.line, padding: 18, gap: 12 },
  mTitle: { fontFamily: theme.font.serif, fontSize: 18, fontWeight: '600', color: theme.color.ink },
  mWarn: { fontSize: 13, color: theme.color.inkSoft, lineHeight: 18 },
  mWords: { fontSize: 15, lineHeight: 24, color: theme.color.ink, borderWidth: 1, borderColor: theme.color.line, borderStyle: 'dashed', borderRadius: theme.radius.md, padding: 12 },
});

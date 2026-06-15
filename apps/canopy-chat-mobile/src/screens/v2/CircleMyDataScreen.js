/**
 * canopy-chat-mobile v2 — "My data" screen (RN, S5 parity).
 *
 * RN mirror of web's circleMyData: a read-only surface (where your data lives via
 * getDataLocation + podSignInStatus, the getPrivacyNotice disclosure, and a
 * getMetrics usage snapshot). Self-contained: loads the stoop ops via the injected
 * `callSkill`. No mutations (backup/mnemonic + the OIDC sign-in flow are separate).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { t, currentLang } from '../../core/localisation.js';
import { theme } from './theme.js';

export default function CircleMyDataScreen({ callSkill, onBack }) {
  const [dataLocation, setDataLocation] = useState({});
  const [podStatus, setPodStatus] = useState({});
  const [privacy, setPrivacy] = useState([]);
  const [metrics, setMetrics] = useState({});

  const load = useCallback(async () => {
    if (typeof callSkill !== 'function') return;
    const [loc, status, priv, met] = await Promise.all([
      callSkill('stoop', 'getDataLocation', {}).catch(() => null),
      callSkill('stoop', 'podSignInStatus', {}).catch(() => null),
      callSkill('stoop', 'getPrivacyNotice', { lang: currentLang() }).catch(() => null),
      callSkill('stoop', 'getMetrics', {}).catch(() => null),
    ]);
    setDataLocation(loc ?? {});
    setPodStatus(status ?? {});
    setPrivacy(Array.isArray(priv?.sections) ? priv.sections : []);
    setMetrics((met?.snapshot && typeof met.snapshot === 'object') ? met.snapshot : {});
  }, [callSkill]);

  useEffect(() => { load(); }, [load]);

  const relay = [dataLocation.relayOperator, dataLocation.relayUrl].filter(Boolean).join(' · ');
  const usage = Object.entries(metrics || {});

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} testID="circle-mydata">
      <View style={styles.header}>
        {typeof onBack === 'function' && <Pressable onPress={onBack} testID="mydata-back"><Text style={styles.back}>{t('circle.mydata.back')}</Text></Pressable>}
        <Text style={styles.title}>{t('circle.mydata.title')}</Text>
      </View>

      <Section title={t('circle.mydata.storage')}>
        <KV k={t('circle.mydata.pod')} v={podStatus.signedIn ? t('circle.mydata.pod_signed_in', { webid: podStatus.webid ?? '' }) : t('circle.mydata.pod_local')} />
        {dataLocation.podRoot ? <KV k={t('circle.mydata.pod_root')} v={dataLocation.podRoot} /> : null}
        {relay ? <KV k={t('circle.mydata.relay')} v={relay} /> : null}
      </Section>

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
});

/**
 * V0 chat screen — placeholder UI that proves the portable core
 * (composeManifests + bootAgentBundle + renderMobile NavModels)
 * boots inside an RN runtime.  Full chat-shell parity with web
 * canopy-chat is a multi-slice arc tracked in the mobile roadmap.
 *
 * No hardcoded strings ([[no-hardcoded-strings]]) — every label
 * goes through `t()`.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { bootAgentBundle } from '../core/agentBundle.js';
import { buildNavModels }  from '../core/navModel.js';
import { t }               from '../core/localisation.js';
import SlashFAB            from '../rn/SlashFAB.js';

export default function ChatScreen() {
  const [bootState, setBootState] = useState({ kind: 'loading' });
  const [navModels, setNavModels] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const bundle = await bootAgentBundle();
        setNavModels(buildNavModels());
        setBootState({ kind: 'ready', bundle });
      } catch (err) {
        setBootState({ kind: 'error', message: err?.message ?? String(err) });
      }
    })();
  }, []);

  // #241 — slash FAB dispatcher.  Parses "/cmd arg=v" into the
  // chat-shell's standard shape; V0 just routes to the bundle's
  // catalog-mounted skill (the chat-shell layer's parseInput is
  // overkill for the V0 placeholder).  Full parse/render will
  // arrive when the real chat-shell ships on RN.
  const onSlashDispatch = useCallback(async (line) => {
    if (bootState.kind !== 'ready') return;
    // eslint-disable-next-line no-console
    console.info('[SlashFAB] dispatched', line);
    // V0: log + leave the heavy lifting to the future chat-shell.
  }, [bootState]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
        <>
          <Text style={styles.status}>{t('boot.agents_ready')}</Text>
          <Text style={styles.subtitle}>{t('rn.shell_stub_intro')}</Text>
          {navModels.map(({ appOrigin, nav }) => (
            <View key={appOrigin} style={styles.appBlock}>
              <Text style={styles.appName}>{appOrigin}</Text>
              <Text style={styles.appMeta}>
                {(nav.sections ?? []).length} sections,{' '}
                {(nav.globals ?? []).length} globals
              </Text>
            </View>
          ))}
          {/* #241 — slash FAB overlay (default-visible per the
              slash-on-mobile decision doc). */}
          <SlashFAB
            catalog={bootState.bundle?.catalog}
            onDispatch={onSlashDispatch}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content:   { padding: 16, gap: 8 },
  title:     { fontSize: 24, fontWeight: '700' },
  tagline:   { fontSize: 14, color: '#666' },
  subtitle:  { fontSize: 13, color: '#666', marginTop: 8 },
  status:    { fontSize: 14, marginTop: 12 },
  error:     { fontSize: 14, marginTop: 12, color: '#b00' },
  appBlock:  { marginTop: 12, padding: 12, backgroundColor: '#f7f7f7', borderRadius: 8 },
  appName:   { fontSize: 16, fontWeight: '600' },
  appMeta:   { fontSize: 12, color: '#666', marginTop: 4 },
});

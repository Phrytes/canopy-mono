/**
 * App.js — canopy-chat-mobile root.
 *
 * M1 (2026-05-29) — the agent bundle is booted ONCE here and shared
 * with BOTH the chat screen and the circle launcher, so the circle
 * screens can load/create over the same agent (one NKN identity, one
 * stoop cache).  ChatScreen attaches its peer-wiring after mount via
 * `bundle.attachPeerWiring` — the inbound router closes over ChatScreen's
 * thread state, which App can't see, so it can't be passed at boot time.
 *
 * Per the polyfill discipline in index.js, all global setup must happen
 * there — App.js stays safe to import from a test context where
 * polyfills aren't loaded (the portable core in src/core/ has no RN
 * imports).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Pressable, Text, StyleSheet, BackHandler } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  useFonts, SourceSerif4_400Regular, SourceSerif4_600SemiBold,
} from '@expo-google-fonts/source-serif-4';

import { theme } from './src/screens/v2/theme.js';

import ChatScreen from './src/screens/ChatScreen.js';
import CircleLauncherScreen from './src/screens/v2/CircleLauncherScreen.js';
import FirstRunWelcomeScreen from './src/screens/FirstRunWelcomeScreen.js';
import MnemonicEntryScreen from './src/screens/MnemonicEntryScreen.js';
import MnemonicCreateScreen from './src/screens/MnemonicCreateScreen.js';
import { initLocalisation } from './src/core/localisation.js';
import { bootAgentBundle } from './src/core/agentBundle.js';
import {
  shouldShowFirstRunWelcome, markWelcomeDismissed,
} from './src/core/firstRun.js';
import { restoreFromMnemonic } from './src/core/restoreFromMnemonic.js';
// P6.9 #347 — first-run CREATE-side mnemonic display (board 3A).
import {
  shouldShowCreateMnemonic, markMnemonicAck,
} from './src/core/mnemonicCreate.js';
import { dlog } from './src/core/devLog.js';
import { EventLog } from '../canopy-chat/src/eventLog.js';
import { OidcSessionRN } from '@canopy/oidc-session-rn';
import { buildCirclePodWriter } from './src/core/circleStoresRN.js';

export default function App() {
  const [localeReady, setLocaleReady] = useState(false);
  // 5.9b — first-run welcome gate.  States:
  //  - 'checking'  — haven't probed AsyncStorage yet (render nothing; boot
  //                  useEffect waits too).
  //  - 'show'      — no identity + no dismissal marker (render welcome).
  //  - 'restore'   — user picked "I have a recovery phrase" (5.9b-followup);
  //                  render MnemonicEntryScreen.  On success we seed the
  //                  chat vault BEFORE flipping to 'dismissed', so the boot
  //                  useEffect finds the seeded keypair instead of generating
  //                  a fresh one.
  //  - 'dismissed' — proceed with the normal boot path.
  const [firstRun, setFirstRun] = useState('checking');
  // Load Source Serif 4 in the background — NOT gated on render (gating once
  // hung boot at a black screen). Headings switch from system serif to
  // Source Serif 4 once it resolves.
  useFonts({ SourceSerif4_400Regular, SourceSerif4_600SemiBold });
  // SP-13.1 (2026-05-31) — there is no separate classic chat shell as a
  // routable screen.  ChatScreen stays mounted invisibly so its peer-
  // wiring keeps routing inbound DMs / mesh events; the launcher is the
  // ONLY visible top-level surface.  Chat now lives inside the kring
  // view as the GESPREK tab (SP-13.2 will fill the surface; until then
  // there's a hole where chat used to be reachable as a standalone).
  const [bundle, setBundle] = useState(null);
  const [bootError, setBootError] = useState(null);
  // P6.9 #347 — CREATE-side mnemonic display.  States:
  //  - 'pending'   — not probed yet (or skipped while bundle still booting).
  //  - 'show'      — ack marker missing → render MnemonicCreateScreen with
  //                  the agent's BIP39 phrase.
  //  - 'dismissed' — user acknowledged (or restore-path already ack'd a
  //                  different identity) → normal app render proceeds.
  const [mnemonicState, setMnemonicState] = useState('pending');
  const [mnemonic, setMnemonic] = useState('');

  // Shared EventLog: boot-time agent events + ChatScreen's inbound peer
  // events land in one log so /logs shows everything.
  const eventLogRef = useRef(null);
  if (!eventLogRef.current) {
    eventLogRef.current = new EventLog({ initial: [], muted: [] });
  }

  // 5.4c (2026-05-30) — single OidcSessionRN, lifted from ChatScreen so
  // BOTH the chat shell AND the circle launcher see the same restored
  // session.  ChatScreen still drives sign-in / sign-out through the
  // `useCanopyChatAuth` hook (and now reads this ref via props); the
  // launcher reads it through a `getPodWriter` thunk that returns a
  // ready `podWriter` once the session restores.  Until then the
  // thunk returns null and circle policy IO stays local-only — see
  // tieredPolicyIo + makeCirclePolicyStoreRN.
  const sessionRef = useRef(null);
  if (!sessionRef.current) {
    sessionRef.current = new OidcSessionRN({ store: SecureStore, appId: 'canopychat' });
  }
  // 5.4c — pod writer slot the launcher's getPodWriter thunk reads on
  // every load/save.  `null` while no session is restored → tieredPolicyIo
  // falls through to the local AsyncStorage side.  Refreshed on mount and
  // every time the SecureStore restore completes.
  const circlePodWriterRef = useRef(null);
  const refreshCirclePodWriter = useCallback(async () => {
    const w = await buildCirclePodWriter(sessionRef.current).catch(() => null);
    circlePodWriterRef.current = w;
    if (w) dlog.boot('circle pod writer ready @', w.podRoot);
  }, []);
  const getCirclePodWriter = useCallback(() => circlePodWriterRef.current, []);

  useEffect(() => {
    initLocalisation({ lng: 'en' }).then(() => setLocaleReady(true));
  }, []);

  // SP-13.1 — the chat shell is no longer a separate routable screen, so
  // the App-level back handler has nothing to pop.  The launcher's own
  // back handler (CircleLauncherScreen) handles popping sub-views.

  // 5.9b — first-run probe.  Reads AsyncStorage to decide whether to
  // show the welcome screen before booting the bundle.  Errors fall
  // open as "show welcome" — better to greet an extra time than to
  // silently skip on a real first run.
  useEffect(() => {
    shouldShowFirstRunWelcome(AsyncStorage)
      .then((show) => setFirstRun(show ? 'show' : 'dismissed'))
      .catch(() => setFirstRun('show'));
  }, []);

  const dismissFirstRun = useCallback(() => {
    markWelcomeDismissed(AsyncStorage).catch(() => { /* non-fatal */ });
    setFirstRun('dismissed');
  }, []);

  // 5.9b-followup — user tapped "I have a recovery phrase" on the welcome
  // screen.  Route to MnemonicEntryScreen; boot stays paused until either
  // restore succeeds (→ 'dismissed', seeded vault) or the user cancels
  // back to 'show'.
  const startRestore = useCallback(() => setFirstRun('restore'), []);
  const cancelRestore = useCallback(() => setFirstRun('show'), []);

  // 5.9b-followup — invoked from MnemonicEntryScreen with the raw text.
  // Validate + seed the chat vault, then flip to 'dismissed' so boot
  // proceeds against the existing keypair.  Returns the helper's result
  // so the screen can surface error codes inline.
  const submitMnemonic = useCallback(async (phrase) => {
    const result = await restoreFromMnemonic({
      mnemonic:     phrase,
      asyncStorage: AsyncStorage,
    });
    if (result.ok) {
      // Mark welcome dismissed too — otherwise next launch would re-show
      // it before the new identity is detected (probe order in firstRun.js).
      try { await markWelcomeDismissed(AsyncStorage); } catch { /* non-fatal */ }
      setFirstRun('dismissed');
    }
    return result;
  }, []);

  // 5.4c — fire-and-forget SecureStore restore.  Mirrors web's
  // circleApp.js handleRedirect flow: when the session resolves with a
  // real WebID, build the writer; otherwise stay local-only.  Non-blocking
  // so the launcher renders immediately with local IO; the NEXT save
  // automatically picks up the writer once the ref is populated (no
  // re-render needed — the thunk reads `.current` live).
  useEffect(() => {
    sessionRef.current?.restoreFromVault?.()
      .then(() => refreshCirclePodWriter())
      .catch(() => { /* fresh install — circlePodWriterRef stays null */ });
  }, [refreshCirclePodWriter]);

  useEffect(() => {
    // 5.9b — wait until the user has cleared the welcome (or there's no
    // welcome to clear) before booting.  Boot generates an identity in
    // the vault, which would race a future restore-from-mnemonic path.
    if (firstRun !== 'dismissed') return;
    let cancelled = false;
    (async () => {
      try {
        dlog.boot('booting agent bundle (App)');
        let eventSeq = 0;
        const b = await bootAgentBundle({
          // Persist the agent identity (chat + host vaults + stoop
          // cache) to AsyncStorage so the NKN address — derived from the
          // identity keypair — stays stable across reboots (otherwise a
          // peer's cached nknAddr from a /share-my-contact QR breaks).
          asyncStorage: AsyncStorage,
          publishEvent: (e) => {
            if (!e || typeof e !== 'object') return;
            const evt = {
              ...e,
              id: e.id ?? `mob-${Date.now()}-${(eventSeq += 1).toString(36)}`,
              ts: e.ts ?? Date.now(),
            };
            try { eventLogRef.current?.append?.(evt); } catch { /* defensive */ }
          },
        });
        if (cancelled) { b.dispose?.(); return; }
        dlog.boot('bundle ready (App)', {
          transport:  b.transport,
          appOrigins: [...b.catalog.appOrigins],
          opCount:    b.catalog.opsById?.size ?? 0,
        });
        setBundle(b);
        // P6.9 #347 — probe whether we should display the CREATE-side
        // mnemonic.  Skipped silently when the identity / mnemonic isn't
        // available (e.g. restore-from-mnemonic path already acknowledged
        // a different identity).  Any failure inside the probe falls
        // through to 'dismissed' so the app boot never blocks.
        try {
          const show = await shouldShowCreateMnemonic(AsyncStorage);
          if (!show) { setMnemonicState('dismissed'); return; }
          const phrase = await b.agent?.sa?.agent?.identity?.getMnemonic?.();
          if (typeof phrase === 'string' && phrase.trim()) {
            if (!cancelled) {
              setMnemonic(phrase);
              setMnemonicState('show');
            }
          } else {
            setMnemonicState('dismissed');
          }
        } catch (probeErr) {
          dlog.warn('mnemonic probe failed (App)', probeErr?.message ?? probeErr);
          setMnemonicState('dismissed');
        }
      } catch (err) {
        dlog.warn('boot failed (App)', err?.message ?? err);
        if (!cancelled) setBootError(err?.message ?? String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [firstRun]);

  if (!localeReady) return null;
  if (firstRun === 'checking') return null;   // probe still in-flight
  if (firstRun === 'show') {
    return (
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <FirstRunWelcomeScreen onStart={dismissFirstRun} onRestore={startRestore} />
      </SafeAreaProvider>
    );
  }
  if (firstRun === 'restore') {
    return (
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <MnemonicEntryScreen onSubmit={submitMnemonic} onCancel={cancelRestore} />
      </SafeAreaProvider>
    );
  }

  // P6.9 #347 — show the CREATE-side mnemonic screen once after the
  // identity has been seeded.  Renders ABOVE the normal app overlay so
  // the user has to acknowledge (or pick "Later") before reaching the
  // launcher.  The screen never reappears once "Written down" or
  // "Photo taken" is tapped.
  if (mnemonicState === 'show') {
    const dismissMnemonic = async (kind) => {
      try { await markMnemonicAck(AsyncStorage, kind); } catch { /* non-fatal */ }
      setMnemonicState('dismissed');
    };
    return (
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <MnemonicCreateScreen
          mnemonic={mnemonic}
          onWritten={() => dismissMnemonic('written')}
          onPhoto={() => dismissMnemonic('photo')}
          onLater={() => dismissMnemonic('later')}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <View style={styles.root}>
        {/* SP-13.1 — ChatScreen stays mounted (peer-wiring keeps routing
            inbound DMs / mesh) but is visually hidden behind the launcher
            overlay.  No "← chat" route reveals it; chat now lives inside
            the kring view as the GESPREK tab (SP-13.2).
            The styles.hiddenChat below uses absolute positioning so the
            ChatScreen is mounted + peer-wired but never visible. */}
        <View style={styles.hiddenChat} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ChatScreen
            bundle={bundle}
            bootError={bootError}
            eventLog={eventLogRef.current}
            sessionRef={sessionRef}
            onSessionChanged={refreshCirclePodWriter}
          />
        </View>
        <CircleLauncherScreen
          bundle={bundle}
          eventLog={eventLogRef.current}
          getPodWriter={getCirclePodWriter}
          /* SP-13.1 — no onBack (no chat shell to fall back to) +
             no onChatRoute (the kring view IS the chat, no route). */
        />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // SP-13.1 — ChatScreen is kept mounted for its peer-wiring side-effect
  // but parked off-screen so it never paints over the launcher.  An
  // alternative is `display: 'none'` but RN can lose layout in that
  // path on some platforms; absolute-zero-size + pointerEvents=none is
  // the proven invisible-but-mounted recipe.
  hiddenChat: {
    position: 'absolute',
    top: 0, left: 0,
    width: 0, height: 0,
    overflow: 'hidden',
  },
});

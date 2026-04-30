/**
 * SignInScreen — entry point when no OIDC session is restored.
 *
 * Shows a "Sign in with Solid" button that drives the
 * `expo-auth-session` flow against Inrupt's hosted IdP.  After token
 * exchange, the user is asked for their pod root URL (defaults to a
 * sensible guess derived from the WebID when available).  Both pieces
 * are handed to ServiceContext.adoptTokens which boots the engine.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { useFolioAuth, DEFAULT_INRUPT_ISSUER } from '../auth/folioAuth.js';
import { useService } from '../ServiceContext.js';
import { suggestPodRoot, normalizePodRoot, discoverPodRoot } from '../lib/podRootHelpers.js';

export { suggestPodRoot, normalizePodRoot };

/**
 * @param {object} [props]
 * @param {string} [props.issuer]   Override the Inrupt issuer (tests / staging).
 */
export function SignInScreen({ issuer = DEFAULT_INRUPT_ISSUER } = {}) {
  const { adoptTokens, status } = useService();
  const [stage, setStage]       = useState('idle');     // idle | signing-in | got-tokens | configuring
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const [pendingTokens, setPendingTokens] = useState(null);
  const [podRootInput, setPodRootInput]   = useState('');

  const { ready, signIn, lastError } = useFolioAuth({ issuer });

  const onSignInPress = useCallback(async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const tokens = await signIn();
      setPendingTokens(tokens);
      // Pre-fill: instant heuristic (origin + /folio/) so the input is
      // never empty, then async WebID-profile discovery to replace with
      // the actual pim:storage URL (Inrupt separates id.* from storage.*).
      if (tokens.webid) {
        setPodRootInput(suggestPodRoot(tokens.webid));
        discoverPodRoot(tokens.webid, { accessToken: tokens.accessToken })
          .then((real) => { if (real) setPodRootInput(real + 'folio/'); })
          .catch(() => { /* keep heuristic */ });
      }
      setStage('got-tokens');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [ready, busy, signIn]);

  const onContinuePress = useCallback(async () => {
    if (busy) return;
    if (!pendingTokens) return;
    if (!podRootInput || podRootInput.length === 0) {
      setError(new Error('Pod root URL is required'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adoptTokens(pendingTokens, { podRoot: normalizePodRoot(podRootInput) });
      setStage('configuring');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, pendingTokens, podRootInput, adoptTokens]);

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.h1}>Folio</Text>
        <Text style={s.h2}>Your markdown notes, mirrored into your Solid pod.</Text>

        {stage !== 'got-tokens' && (
          <View style={s.section}>
            <Pressable
              onPress={onSignInPress}
              disabled={!ready || busy}
              style={({ pressed }) => [
                s.primaryBtn,
                (!ready || busy) && { opacity: 0.6 },
                pressed && { opacity: 0.8 },
              ]}
            >
              {busy
                ? <ActivityIndicator color="#0f1117" />
                : <Text style={s.primaryBtnLabel}>Sign in with Solid</Text>}
            </Pressable>
            <Text style={s.hint}>
              You will be sent to {issuer} in a secure browser window.
            </Text>
          </View>
        )}

        {stage === 'got-tokens' && (
          <View style={s.section}>
            <Text style={s.label}>Pod root URL</Text>
            <TextInput
              value={podRootInput}
              onChangeText={setPodRootInput}
              placeholder="https://you.solidcommunity.net/folio/"
              placeholderTextColor="#5c6377"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={s.input}
            />
            <Text style={s.hintSmall}>
              The container in your pod where Folio will read + write notes.
              Trailing slash will be added automatically.
            </Text>
            <Pressable
              onPress={onContinuePress}
              disabled={busy || podRootInput.length === 0}
              style={({ pressed }) => [
                s.primaryBtn,
                (busy || podRootInput.length === 0) && { opacity: 0.6 },
                pressed && { opacity: 0.8 },
              ]}
            >
              {busy
                ? <ActivityIndicator color="#0f1117" />
                : <Text style={s.primaryBtnLabel}>Continue</Text>}
            </Pressable>
          </View>
        )}

        {(error || lastError) && (
          <View style={s.errorBox}>
            <TextInput
              style={s.errorInput}
              multiline
              scrollEnabled
              selectTextOnFocus
              autoCorrect={false}
              autoCapitalize="none"
              value={
                `${error ? '[onPress] ' : '[hook] '}` +
                `${error?.message ?? lastError?.message ?? String(error ?? lastError)}\n` +
                `${String(error?.stack ?? lastError?.stack ?? '').split('\n').slice(0, 12).join('\n')}`
              }
              onChangeText={() => {}}
            />
          </View>
        )}

        <View style={s.statusBox}>
          <Text style={s.statusLabel}>State: <Text style={s.statusValue}>{status}</Text></Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: '#0f1117' },
  scroll:         { padding: 24, paddingTop: 80 },
  h1:             { color: '#d4d8f0', fontSize: 32, fontWeight: '700', marginBottom: 8 },
  h2:             { color: '#8c93b8', fontSize: 14, lineHeight: 20, marginBottom: 32 },
  section:        { marginBottom: 24 },
  label:          { color: '#9aa0c4', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  input:          {
    backgroundColor: '#1a1d27',
    color:           '#d4d8f0',
    fontSize:        15,
    paddingHorizontal: 14,
    paddingVertical:   12,
    borderRadius:      8,
    borderWidth:       1,
    borderColor:       '#2a2f3f',
    fontFamily:        Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  hint:           { color: '#6b7094', fontSize: 12, marginTop: 16, lineHeight: 18 },
  hintSmall:      { color: '#6b7094', fontSize: 11, marginTop: 8, marginBottom: 16, lineHeight: 16 },
  primaryBtn:     {
    backgroundColor: '#9bcfff',
    paddingVertical: 14,
    borderRadius:    8,
    alignItems:      'center',
    marginTop:       8,
  },
  primaryBtnLabel:{ color: '#0f1117', fontSize: 16, fontWeight: '700' },
  errorBox:       { backgroundColor: '#3a1f23', padding: 12, borderRadius: 6, marginBottom: 12 },
  errorText:      { color: '#f0a8a8', fontSize: 12, fontFamily: 'monospace' },
  errorInput:     {
    color:           '#f0a8a8',
    fontSize:        11,
    fontFamily:      Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: 'transparent',
    padding:         0,
    margin:          0,
    minHeight:       120,
    textAlignVertical: 'top',
  },
  statusBox:      { marginTop: 24, alignItems: 'center' },
  statusLabel:    { color: '#5c6377', fontSize: 12 },
  statusValue:    { color: '#9aa0c4', fontFamily: 'monospace' },
});

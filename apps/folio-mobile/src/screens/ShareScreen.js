/**
 * ShareScreen — mint a PodCapabilityToken from the user's mobile vault.
 *
 * Form: WebID (subject), scope (path under pod root), expires-in (days).
 * Tap "Mint token" → calls `PodCapabilityToken.issue(...)` with the
 * agent identity and surfaces the resulting JSON for the user to copy.
 *
 * v0 limitation: this screen requires that an `AgentIdentity` is
 * available via the engine (Q-Folio.3 auto-share is configured at the
 * desktop driver — on mobile there's no identity attached by default
 * yet).  When no identity is present we surface a friendly notice so
 * the user knows the v0 mobile build can't issue tokens (planned for
 * a follow-up slice).
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useService } from '../ServiceContext.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function ShareScreen() {
  const { engine, podRoot } = useService();
  const navigation = useNavigation();

  const [subject, setSubject] = useState('');
  const [scope,   setScope]   = useState('pod.read:/notes/');
  const [days,    setDays]    = useState('7');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState(null);
  const [token,   setToken]   = useState(null);

  React.useEffect(() => {
    navigation?.setOptions?.({ title: 'Share' });
  }, [navigation]);

  const onMint = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setToken(null);
    try {
      if (!engine?.identity) {
        throw Object.assign(
          new Error(
            'No AgentIdentity attached on mobile yet — capability sharing from the phone is planned for a follow-up. ' +
            'Use the desktop CLI `folio share ...` for now.',
          ),
          { code: 'NO_IDENTITY' },
        );
      }
      const expiresIn = Math.max(1, Number(days) || 1) * ONE_DAY_MS;
      const { PodCapabilityToken } = await import('@canopy/core');
      const minted = await PodCapabilityToken.issue(engine.identity, {
        subject:   subject.trim(),
        pod:       podRoot,
        scopes:    [scope.trim()],
        expiresIn,
      });
      setToken(minted.toString());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, engine, podRoot, subject, scope, days]);

  return (
    <ScrollView style={s.root} contentContainerStyle={s.scroll}>
      <Text style={s.label}>Recipient WebID (subject pubKey or WebID)</Text>
      <TextInput
        value={subject}
        onChangeText={setSubject}
        placeholder="z6Mk... or https://they.solidcommunity.net/profile/card#me"
        placeholderTextColor="#5c6377"
        autoCapitalize="none"
        autoCorrect={false}
        style={s.input}
      />

      <Text style={s.label}>Scope</Text>
      <TextInput
        value={scope}
        onChangeText={setScope}
        placeholder="pod.read:/notes/"
        placeholderTextColor="#5c6377"
        autoCapitalize="none"
        autoCorrect={false}
        style={s.input}
      />
      <Text style={s.hint}>
        Examples: pod.read:/notes/   pod.write:/projects/   pod.*:/shared/foo.md
      </Text>

      <Text style={s.label}>Expires in (days)</Text>
      <TextInput
        value={days}
        onChangeText={setDays}
        keyboardType="numeric"
        style={s.input}
      />

      <Pressable
        onPress={onMint}
        disabled={busy || !subject || !scope}
        style={({ pressed }) => [
          s.primaryBtn,
          (busy || !subject || !scope) && { opacity: 0.5 },
          pressed && { opacity: 0.8 },
        ]}
      >
        {busy
          ? <ActivityIndicator color="#0f1117" />
          : <Text style={s.primaryBtnLabel}>Mint capability token</Text>}
      </Pressable>

      {token && (
        <View style={s.tokenBox}>
          <Text style={s.tokenLabel}>Capability token (long-press to copy)</Text>
          <Text style={s.tokenText} selectable>{token}</Text>
        </View>
      )}

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error?.message ?? String(error)}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#0f1117' },
  scroll: { padding: 16 },
  label:  { color: '#9aa0c4', fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input:  {
    backgroundColor: '#1a1d27', color: '#d4d8f0', fontSize: 14,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#2a2f3f', fontFamily: 'monospace',
  },
  hint:   { color: '#6b7094', fontSize: 11, marginTop: 6, lineHeight: 16 },
  primaryBtn: {
    backgroundColor: '#9bcfff', paddingVertical: 14, borderRadius: 8,
    alignItems: 'center', marginTop: 24,
  },
  primaryBtnLabel: { color: '#0f1117', fontSize: 15, fontWeight: '700' },
  tokenBox: {
    marginTop: 20, padding: 12, backgroundColor: '#141720',
    borderRadius: 8, borderWidth: 1, borderColor: '#2a2f3f',
  },
  tokenLabel: { color: '#9aa0c4', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  tokenText:  { color: '#d4d8f0', fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },
  errorBox: { backgroundColor: '#3a1f23', padding: 12, borderRadius: 6, marginTop: 16 },
  errorText:{ color: '#f0a8a8', fontSize: 12, fontFamily: 'monospace' },
});

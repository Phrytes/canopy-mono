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

  const [mode, setMode] = useState(null);  // 'acp' | 'wac' | 'cap-token' on success

  /**
   * Phase 52.16.6 (2026-05-14) — try ACP first when the engine has a
   * PodClient with `.sharing` AND the pod supports it. Fall back to
   * cap-token issuance via the agent identity (the V0 path).
   *
   * Mobile typically has access to the user's WebID session via
   * `engine.podClient`, so the ACP path is the common case after
   * Phase 52.15 sign-in. Cap-token remains for offline / power-user
   * scenarios.
   */
  const onMint = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setToken(null);
    setMode(null);
    try {
      const subj = subject.trim();
      const scp  = scope.trim();
      if (!subj || !scp) {
        throw new Error('Recipient + scope are required');
      }

      // 1. Try ACP path via podClient.sharing if available.
      const podClient = engine?.podClient ?? null;
      if (podClient?.sharing) {
        try {
          const acpModes = _scopeToAcpModes(scp);
          const targetUri = _scopeToTargetUri(scp, podRoot);
          const isContainer = targetUri.endsWith('/');
          const grant = await podClient.sharing.grant({
            ...(isContainer ? { containerUri: targetUri } : { resourceUri: targetUri }),
            agent: subj,
            modes: acpModes,
          });
          setToken(JSON.stringify(grant, null, 2));
          setMode(grant.mode);  // 'acp' | 'wac'
          return;
        } catch (acpErr) {
          // Fall through to cap-token on ACP failure (unless explicit
          // ACP-only mode is needed — we use auto here).
          if (acpErr?.code !== 'SHARING_NOT_SUPPORTED' && acpErr?.code !== 'SHARING_SDK_MISSING') {
            // Real ACP error — surface it.
            throw acpErr;
          }
        }
      }

      // 2. Cap-token path (V0, also the fall-back when no PodClient).
      if (!engine?.identity) {
        throw Object.assign(
          new Error(
            'No AgentIdentity attached on mobile yet, AND the pod doesn\'t support ACP — ' +
            'capability sharing from the phone is planned for a follow-up. ' +
            'Use the desktop CLI `folio share ...` for now.',
          ),
          { code: 'NO_IDENTITY' },
        );
      }
      const expiresIn = Math.max(1, Number(days) || 1) * ONE_DAY_MS;
      const { PodCapabilityToken } = await import('@canopy/core');
      const minted = await PodCapabilityToken.issue(engine.identity, {
        subject:   subj,
        pod:       podRoot,
        scopes:    [scp],
        expiresIn,
      });
      setToken(minted.toString());
      setMode('cap-token');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, engine, podRoot, subject, scope, days]);

  /** Parse "pod.read:/path" → ['read']. Accepts read|write|delete|*. */
  function _scopeToAcpModes(scopeStr) {
    const m = scopeStr.match(/^pod\.(read|write|delete|\*):/);
    if (!m) throw new Error(`unrecognised scope shape "${scopeStr}" — expected pod.<verb>:<path>`);
    switch (m[1]) {
      case 'read':   return ['read'];
      case 'write':  return ['write'];
      case 'delete': return ['write'];
      case '*':      return ['control'];
      default:       throw new Error(`unrecognised scope verb "${m[1]}"`);
    }
  }
  function _scopeToTargetUri(scopeStr, podRootUri) {
    const m = scopeStr.match(/^pod\.\w+:(.+)$/);
    if (!m) throw new Error(`unrecognised scope shape "${scopeStr}"`);
    const path = m[1].replace(/^\/+/, '');
    const root = podRootUri.endsWith('/') ? podRootUri : `${podRootUri}/`;
    return path.length === 0 ? root : `${root}${path}`;
  }

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
          <Text style={s.tokenLabel}>
            {mode === 'acp'  ? 'ACP grant created (long-press to copy)'
            : mode === 'wac' ? 'WAC grant created (long-press to copy)'
            :                  'Capability token (long-press to copy)'}
          </Text>
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

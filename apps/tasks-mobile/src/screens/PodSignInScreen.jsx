/**
 * PodSignInScreen — Solid pod sign-in for tasks-mobile.
 *
 * Phase 41.15.1 (2026-05-09).
 *
 * Mirrors apps/stoop-mobile/src/screens/SignInScreen.js (the
 * Phase-40.23 rewrite that uses useOidcSignIn directly instead of
 * the browser-side sign-in skill).
 *
 * Stages:
 *   1. idle         — user taps "Sign in with Solid"
 *   2. got-tokens   — OIDC PKCE flow returned; user enters/confirms podRoot
 *   3. attached     — bundle.cache.attachInner(podClient) succeeded;
 *                     navigate to AuthCallback for the bulk-sync UI
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { IssuerPicker } from '@canopy/oidc-session-rn/picker';
import { useService }   from '../ServiceContext.js';
import { useI18n }      from '../I18nProvider.js';
import { useTasksAuth, TASKS_OIDC_DEFAULT_ISSUER } from '../auth/useTasksAuth.js';
import { ROUTES } from '../navigation.js';

function _baseFromWebid(webid) {
  if (typeof webid !== 'string' || !webid) return '';
  try { return `${new URL(webid).origin}/`; } catch { return ''; }
}

export function PodSignInScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const [issuer, setIssuer]     = useState(TASKS_OIDC_DEFAULT_ISSUER);
  const [stage, setStage]       = useState('idle');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const [tokens, setTokens]     = useState(null);
  const [podRoot, setPodRoot]   = useState('');

  const auth = useTasksAuth({ issuer });

  const onSignIn = useCallback(async () => {
    if (!auth.ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await auth.signIn();
      if (!r?.accessToken) {
        setError(t('mobile.sign_in.cancelled'));
        return;
      }
      setTokens(r);
      setPodRoot(_baseFromWebid(r.webid));
      setStage('got-tokens');
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [auth, busy, t]);

  const onAttach = useCallback(async () => {
    if (!tokens || !podRoot.trim() || busy) return;
    if (typeof svc?.attachPod !== 'function') {
      setError(t('mobile.sign_in.attach_unavailable'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await svc.attachPod({ tokens, podRoot: podRoot.trim() });
      setStage('attached');
      nav.navigate(ROUTES.AuthCallback);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [tokens, podRoot, busy, svc, nav, t]);

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1, backgroundColor: COLORS.background, padding: SPACING.xl,
      }}
    >
      <Text style={{
        fontSize: FONT_SIZES.xl, fontWeight: '600',
        color: COLORS.text, marginBottom: SPACING.md,
      }}>
        {t('mobile.sign_in.title')}
      </Text>
      <Text style={{
        fontSize: FONT_SIZES.sm, color: COLORS.textMuted,
        marginBottom: SPACING.lg, lineHeight: 20,
      }}>
        {t('mobile.sign_in.subtitle')}
      </Text>

      {stage === 'idle' ? (
        <View>
          <IssuerPicker
            value={issuer}
            onChange={setIssuer}
            legendText={t('mobile.sign_in.issuer_label')}
          />
          <Pressable
            onPress={onSignIn}
            disabled={!auth.ready || busy}
            accessibilityRole="button"
            accessibilityLabel="signin-cta"
            style={({ pressed }) => [
              {
                marginTop: SPACING.lg,
                paddingVertical: SPACING.lg, borderRadius: RADII.md,
                alignItems: 'center',
                backgroundColor: (auth.ready && !busy) ? COLORS.primary : COLORS.surfaceMuted,
              },
              pressed && auth.ready && !busy && { opacity: 0.85 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={COLORS.textInverse} />
            ) : (
              <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' }}>
                {t('mobile.sign_in.cta')}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {stage === 'got-tokens' ? (
        <View>
          <Text style={{ color: COLORS.success, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md }}>
            {t('mobile.sign_in.tokens_received', null).replace('{webid}', tokens?.webid ?? '?')}
          </Text>
          <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm, marginBottom: SPACING.sm }}>
            {t('mobile.sign_in.pod_root_label')}
          </Text>
          <TextInput
            value={podRoot}
            onChangeText={setPodRoot}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="signin-pod-root-input"
            style={_inputStyle(COLORS, SPACING, FONT_SIZES, RADII)}
          />
          <Pressable
            onPress={onAttach}
            disabled={busy || !podRoot.trim()}
            accessibilityRole="button"
            accessibilityLabel="signin-attach"
            style={({ pressed }) => [
              {
                marginTop: SPACING.lg,
                paddingVertical: SPACING.lg, borderRadius: RADII.md,
                alignItems: 'center',
                backgroundColor: (!busy && podRoot.trim()) ? COLORS.primary : COLORS.surfaceMuted,
              },
              pressed && !busy && podRoot.trim() && { opacity: 0.85 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={COLORS.textInverse} />
            ) : (
              <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' }}>
                {t('mobile.sign_in.attach_cta')}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md }}>
          {error}
        </Text>
      ) : null}

      {auth.lastError ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.xs, marginTop: SPACING.sm }}>
          {String(auth.lastError?.message ?? auth.lastError)}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function _inputStyle(COLORS, SPACING, FONT_SIZES, RADII) {
  return {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
    backgroundColor: COLORS.surface,
  };
}

/**
 * SignInScreen — pod sign-in via OIDC.
 *
 * Stoop V3 Phase 40.19 (2026-05-08).  V3 mobile is local-by-default;
 * pod sign-in is opt-in.
 *
 * Flow:
 *   1. User taps "Aanmelden met Inrupt".
 *   2. `startPodSignIn({issuer, redirectUrl})` → returns the IdP's
 *      authorize URL.
 *   3. We open it via `WebBrowser.openAuthSessionAsync` — the
 *      Stoop:// scheme catches the redirect.
 *   4. On callback, `completePodSignIn({callbackUrl})` finalises
 *      the OIDC dance and attaches a SolidPodSource to the bundle.
 *   5. Navigate to AuthCallbackScreen which polls `getBulkSyncStatus`
 *      while the bulk-sync runs.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as WebBrowser   from 'expo-web-browser';
import * as Linking      from 'expo-linking';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/i18n.js';
import { useService }                         from '../ServiceContext.js';
import { useSkill }                           from '../lib/useSkill.js';
import { useSkillResult }                    from '../lib/useSkillResult.js';

const DEFAULT_ISSUER = 'https://login.inrupt.com';

export function SignInScreen() {
  const nav = useNavigation();
  const svc = useService();

  const [issuer, setIssuer] = useState(DEFAULT_ISSUER);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);

  const start    = useSkill('startPodSignIn');
  const complete = useSkill('completePodSignIn');
  const signOut  = useSkill('signOutOfPod');
  const status   = useSkillResult('podSignInStatus', {}, []);

  // Listen for the deep-link callback so the OIDC redirect closes
  // the loop without the user touching anything.
  useEffect(() => {
    const sub = Linking.addEventListener('url', async (event) => {
      const url = event?.url ?? '';
      if (!url.startsWith('stoop://auth/callback')) return;
      try {
        const r = await complete.call({ callbackUrl: url });
        if (r?.error) throw new Error(r.error);
        await status.refresh();
        nav.navigate(ROUTES.AuthCallback);
      } catch (err) {
        setError(err?.message ?? String(err));
      }
    });
    return () => sub?.remove?.();
  }, [complete, nav, status]);

  if (!svc?.activeBundle) {
    return (
      <ScrollView contentContainerStyle={styles.root}>
        <Text style={styles.heading}>{t('signin.heading', 'Pod-aanmelding')}</Text>
        <Text style={styles.body}>
          {t('signin.no_active_group',
             'Sluit eerst aan bij een groep voordat je een pod koppelt.')}
        </Text>
      </ScrollView>
    );
  }

  const beginSignIn = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const redirectUrl = Linking.createURL('auth/callback', { scheme: 'stoop' });
      const r = await start.call({ issuer, redirectUrl });
      if (r?.error) throw new Error(r.error);
      const authUrl = r?.authorizeUrl ?? r?.url;
      if (!authUrl) throw new Error('signin.no_auth_url');
      await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      // The 'url' event handler above completes the flow; nothing
      // else to do here.
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, start, issuer]);

  const onSignOut = async () => {
    setError(null);
    try {
      await signOut.call({});
      await status.refresh();
    } catch (err) { setError(err?.message ?? String(err)); }
  };

  const session = status.data ?? {};
  const signedIn = !!session.signedIn;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>{t('signin.heading', 'Pod-aanmelding')}</Text>
      <Text style={styles.body}>
        {t('signin.body',
           'Koppel je Solid-pod om profiel + posts cross-device te synchroniseren.')}
      </Text>

      {status.loading || busy ? <ActivityIndicator style={{ marginVertical: SPACING.md }} /> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {signedIn ? (
        <View style={styles.section}>
          <Text style={styles.statusOk}>
            {t('signin.signed_in', 'Aangemeld als {webid}')
              .replace('{webid}', String(session.webid ?? '—'))}
          </Text>
          <Text style={styles.body}>
            {session.podAttached
              ? t('signin.pod_attached', 'Pod is gekoppeld.')
              : t('signin.pod_not_attached', 'Pod is niet gekoppeld.')}
          </Text>
          <Pressable
            onPress={onSignOut}
            style={styles.btnSecondary}
            accessibilityRole="button"
            accessibilityLabel="signin-signout"
          >
            <Text style={styles.btnSecondaryLabel}>{t('signin.signout', 'Afmelden')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.label}>{t('signin.issuer_label', 'Solid OIDC-issuer')}</Text>
          <TextInput
            value={issuer}
            onChangeText={setIssuer}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={DEFAULT_ISSUER}
            style={styles.input}
            accessibilityLabel="signin-issuer-input"
          />
          <Pressable
            onPress={beginSignIn}
            disabled={busy}
            style={styles.btnPrimary}
            accessibilityRole="button"
            accessibilityLabel="signin-go"
          >
            <Text style={styles.btnPrimaryLabel}>{t('signin.go', 'Aanmelden met Inrupt')}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

export default SignInScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  body:    { fontSize: FONT_SIZES.md, color: COLORS.textMuted, lineHeight: 22, marginBottom: SPACING.lg },
  section: {
    marginBottom: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  label: { fontSize: FONT_SIZES.sm, fontWeight: '500', color: COLORS.text, marginBottom: SPACING.xs },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
    marginBottom: SPACING.md,
  },
  statusOk: { color: COLORS.success, fontSize: FONT_SIZES.sm, fontWeight: '600', marginBottom: SPACING.md },
  btnPrimary: {
    backgroundColor: COLORS.primary, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center',
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center',
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md },
});

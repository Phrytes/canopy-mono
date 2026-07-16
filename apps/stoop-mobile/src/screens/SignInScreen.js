/**
 * SignInScreen — pod sign-in via OIDC (RN flow).
 *
 * Stoop V3 Phase 40.23 follow-up (2026-05-08): the original
 * (Phase 40.19) impl routed through the `startPodSignIn` /
 * `completePodSignIn` skills, which use the **browser** OidcSession
 * (`@inrupt/solid-client-authn-browser` — needs `window`, throws
 * `prototype of undefined` on RN).  This rewrite uses the
 * `useStoopAuth` hook + `ServiceContext.attachPod` directly, mirror
 * of `apps/folio-mobile/src/screens/SignInScreen.js` (different
 * scheme + bundle plumbing).
 *
 * Flow:
 *   1. Tap "Aanmelden met Solid" → `signIn()` runs PKCE OAuth via
 *      `expo-auth-session`, pops Inrupt's IdP in the system browser.
 *   2. On success, the hook returns `{accessToken, webid, ...}`.
 *      Pre-fill a pod-base URL field from the WebID origin.
 *   3. Tap "Doorgaan" → `attachPod({tokens, podRoot})` adopts the
 *      tokens into `OidcSessionRN`, builds `SolidPodSource(podUrl,
 *      authenticatedFetch)`, and calls `bundle.cache.attachInner`.
 *
 * Token persistence rides `expo-secure-store` keyed by `appId:
 * 'stoop'` (`stoop-oidc-*`).
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
  TextInput,
} from 'react-native';

import { IssuerPicker } from '@onderling/oidc-session-rn/picker';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/localisation.js';
import { useService }                         from '../ServiceContext.js';
import { useStoopAuth }                       from '../auth/stoopAuthHook.js';
import { derivePodRootFromWebId }             from '@onderling-app/stoop/lib/derivePodRoot';

const DEFAULT_ISSUER = 'https://login.inrupt.com';

/** Origin-only fallback when WebID-profile discovery isn't done. */
function deriveBaseFromWebId(webid) {
  if (typeof webid !== 'string' || webid.length === 0) return '';
  try {
    return `${new URL(webid).origin}/`;
  } catch { return ''; }
}

export function SignInScreen() {
  const svc = useService();

  const [issuer, setIssuer]   = useState(DEFAULT_ISSUER);
  const [stage, setStage]     = useState('idle');     // idle | got-tokens | attached
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [pendingTokens, setPendingTokens] = useState(null);
  const [podRootInput, setPodRootInput]   = useState('');

  const { ready, signIn, resetClient, lastError } = useStoopAuth({ issuer });

  const onSignInPress = useCallback(async () => {
    if (!ready || busy) return;
    setBusy(true); setError(null);
    try {
      const tokens = await signIn();
      setPendingTokens(tokens);
      if (tokens?.webid) {
        // Pre-fill the writable Pod storage root from the WebID
        // profile's `pim:storage` (NOT the WebID origin — that's the
        // identity host; device-pass #1 404 root cause). Falls back
        // to the origin internally; the field stays user-editable.
        let podRoot = '';
        try {
          podRoot = await derivePodRootFromWebId({
            webid: tokens.webid,
            fetch: globalThis.fetch,
          });
        } catch { /* helper has its own fallback; ignore */ }
        setPodRootInput(podRoot || deriveBaseFromWebId(tokens.webid));
      }
      setStage('got-tokens');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [ready, busy, signIn]);

  const onContinuePress = useCallback(async () => {
    if (busy || !pendingTokens) return;
    const podRoot = podRootInput.trim().replace(/\/+$/, '') + '/';
    if (podRoot.length <= 1) {
      setError(new Error(t('signin.error_pod_root_required',
                            'Pod-URL is verplicht.')));
      return;
    }
    setBusy(true); setError(null);
    try {
      await svc.attachPod({ tokens: pendingTokens, podRoot });
      setStage('attached');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }, [busy, pendingTokens, podRootInput, svc]);

  const onSignOutPress = useCallback(async () => {
    setError(null);
    try {
      await svc.detachPod?.();
      setStage('idle');
      setPendingTokens(null);
      setPodRootInput('');
    } catch (err) { setError(err); }
  }, [svc]);

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

  const podStatus = svc.podStatus ?? { signedIn: false, podAttached: false };
  const signedIn  = !!podStatus.signedIn;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>{t('signin.heading', 'Pod-aanmelding')}</Text>
      <Text style={styles.body}>
        {t('signin.body',
           'Koppel je Solid-pod om profiel + posts cross-device te synchroniseren.')}
      </Text>

      {(busy) ? <ActivityIndicator style={{ marginVertical: SPACING.md }} /> : null}

      {(error || lastError) ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText} selectable>
            {error?.message ?? lastError?.message ?? String(error ?? lastError)}
          </Text>
          <Pressable
            onPress={async () => { setError(null); if (typeof resetClient === 'function') await resetClient(); }}
            style={styles.btnSecondary}
            accessibilityRole="button"
            accessibilityLabel="signin-reset"
          >
            <Text style={styles.btnSecondaryLabel}>
              {t('signin.reset', 'Reset auth & opnieuw proberen')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {signedIn ? (
        <View style={styles.section}>
          <Text style={styles.statusOk}>
            {t('signin.signed_in', 'Aangemeld als {webid}')
              .replace('{webid}', String(podStatus.webid ?? '—'))}
          </Text>
          <Text style={styles.body}>
            {podStatus.podAttached
              ? t('signin.pod_attached',     'Pod is gekoppeld.')
              : t('signin.pod_not_attached', 'Pod is niet gekoppeld.')}
          </Text>
          {podStatus.podRoot ? (
            <Text style={[styles.body, styles.mono]} selectable>{podStatus.podRoot}</Text>
          ) : null}
          <Pressable
            onPress={onSignOutPress}
            style={styles.btnSecondary}
            accessibilityRole="button"
            accessibilityLabel="signin-signout"
          >
            <Text style={styles.btnSecondaryLabel}>{t('signin.signout', 'Afmelden')}</Text>
          </Pressable>
        </View>
      ) : stage === 'got-tokens' ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('signin.pod_root_label', 'Pod-basis-URL')}</Text>
          <TextInput
            value={podRootInput}
            onChangeText={setPodRootInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://storage.inrupt.com/<uuid>/"
            style={styles.input}
            accessibilityLabel="signin-pod-root-input"
          />
          <Text style={styles.hint}>
            {t('signin.pod_root_hint',
               'Standaard afgeleid van je WebID-origin. Pas alleen aan als je opslag elders draait.')}
          </Text>
          <Pressable
            onPress={onContinuePress}
            disabled={busy || podRootInput.length === 0}
            style={[styles.btnPrimary, (busy || podRootInput.length === 0) && styles.btnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="signin-attach-pod"
          >
            <Text style={styles.btnPrimaryLabel}>
              {busy ? t('signin.attaching', 'Koppelen…')
                    : t('signin.continue',  'Doorgaan')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.section}>
          <IssuerPicker
            value={issuer}
            onChange={setIssuer}
            legendText={t('signin.issuer_label', 'Pod-aanbieder')}
            customLabel={t('signin.issuer_custom', 'Andere')}
          />
          <Pressable
            onPress={onSignInPress}
            disabled={!ready || busy}
            style={[styles.btnPrimary, (!ready || busy) && styles.btnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="signin-go"
          >
            <Text style={styles.btnPrimaryLabel}>
              {ready
                ? t('signin.go', 'Aanmelden met Solid')
                : t('signin.preparing', 'Verbinding voorbereiden…')}
            </Text>
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
  mono:    { fontFamily: 'monospace', fontSize: FONT_SIZES.sm, color: COLORS.text },
  section: {
    marginBottom: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  label: { fontSize: FONT_SIZES.sm, fontWeight: '500', color: COLORS.text, marginBottom: SPACING.xs },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  hint:  { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginBottom: SPACING.md },
  statusOk: { color: COLORS.success, fontSize: FONT_SIZES.sm, fontWeight: '600', marginBottom: SPACING.md },
  btnPrimary: {
    backgroundColor: COLORS.primary, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center',
  },
  btnDisabled: { backgroundColor: COLORS.surfaceMuted },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center', marginTop: SPACING.md,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  errorBox: {
    backgroundColor: '#fff0f0', borderColor: COLORS.danger, borderWidth: 1,
    borderRadius: RADII.md, padding: SPACING.md, marginBottom: SPACING.lg,
  },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginBottom: SPACING.sm, fontFamily: 'monospace' },
});

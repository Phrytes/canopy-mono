/**
 * SignInScreen — pod sign-in via OIDC.
 *
 * Stoop V3 mobile.  V3 ships local-only by default; pod sign-in is
 * opt-in (per the README's "Authentication" section).  Phase 40.10
 * lands the screen; the actual hook wiring is left for bring-up
 * code (the `@canopy/oidc-session-rn/hook`'s `useOidcSignIn` is
 * built to be call-the-hook-and-render).
 *
 * The `useSignInHook` prop is the lib's `useOidcSignIn` (or a stub
 * for tests / placeholder); not calling it directly in the screen
 * keeps tests + scaffolding from depending on a live OIDC.
 */

import React from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/i18n.js';

/**
 * @param {object} props
 * @param {() => {status: string, signIn?: Function, signOut?: Function, error?: any, session?: object}} [props.useSignInHook]
 *   Hook returning the OIDC state machine view.  When omitted, the
 *   screen renders a placeholder.
 */
export function SignInScreen({ useSignInHook } = {}) {
  const state = (typeof useSignInHook === 'function')
    ? useSignInHook()
    : { status: 'idle' };

  const { status, signIn, signOut, error, session } = state ?? {};

  if (typeof useSignInHook !== 'function') {
    return (
      <ScrollView contentContainerStyle={styles.root}>
        <Text style={styles.heading}>{t('signin.heading', 'Pod-aanmelding')}</Text>
        <Text style={styles.body}>
          {t('signin.placeholder',
             'Pod-sign-in is in deze build niet aangesloten. V3 draait standaard lokaal; pod-koppeling komt in een volgende build.')}
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>{t('signin.heading', 'Pod-aanmelding')}</Text>
      <Text style={styles.body}>
        {t('signin.body',
           'Koppel je Solid-pod om profiel + posts cross-device te synchroniseren.')}
      </Text>

      {status === 'in_progress' ? (
        <ActivityIndicator />
      ) : null}

      {error ? (
        <Text style={styles.errorText}>{String(error?.message ?? error)}</Text>
      ) : null}

      {session ? (
        <View style={styles.section}>
          <Text style={styles.statusOk}>
            {t('signin.signed_in', 'Aangemeld als {webid}')
              .replace('{webid}', String(session.webId ?? session.webid ?? '—'))}
          </Text>
          <Pressable
            onPress={() => { try { signOut?.(); } catch { /* ignore */ } }}
            style={styles.btnSecondary}
            accessibilityRole="button"
            accessibilityLabel="signin-signout"
          >
            <Text style={styles.btnSecondaryLabel}>
              {t('signin.signout', 'Afmelden')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => { try { signIn?.(); } catch { /* ignore */ } }}
          disabled={status === 'in_progress'}
          style={styles.btnPrimary}
          accessibilityRole="button"
          accessibilityLabel="signin-go"
        >
          <Text style={styles.btnPrimaryLabel}>
            {t('signin.go', 'Aanmelden met Inrupt')}
          </Text>
        </Pressable>
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

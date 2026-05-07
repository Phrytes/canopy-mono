/**
 * OnboardRestoreScreen — restore identity from a 12/24-word mnemonic.
 *
 * Stoop V3 Phase 40.10. Pure UI: collects the phrase, runs the
 * structural check from `lib/mnemonic.js`, then calls the
 * `onSubmitMnemonic` callback (wired in 40.10-H to a `restoreFromMnemonic`
 * SDK call). Deep validation against the BIP-39 wordlist happens
 * server-side in the SDK; the screen surfaces the verdict.
 *
 * Accepts `route.params.prefilledMnemonic` so OnboardScan can hand
 * over a recovery-phrase QR.
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { ROUTES }                          from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                               from '../lib/i18n.js';
import {
  normaliseMnemonic, statusFor, looksLikeMnemonic,
} from '../lib/mnemonic.js';

/**
 * @param {object} [props]
 * @param {(phrase: string) => Promise<unknown>} [props.onSubmitMnemonic]
 *   Bring-up code injects the SDK call.  When omitted, the screen
 *   shows a no-op submit (handy for the navigation skeleton).
 */
export function OnboardRestoreScreen({ onSubmitMnemonic } = {}) {
  const nav   = useNavigation();
  const route = useRoute();
  const [phrase, setPhrase] = useState(route?.params?.prefilledMnemonic ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
  }, [phrase]);

  const status = statusFor(phrase);
  const canSubmit = !submitting && looksLikeMnemonic(phrase);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const norm = normaliseMnemonic(phrase);
      if (typeof onSubmitMnemonic === 'function') {
        await onSubmitMnemonic(norm);
      }
      nav.navigate(ROUTES.Feed, { firstRun: true });
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.title}>
        {t('onboard_restore.heading', 'Herstel je identiteit')}
      </Text>
      <Text style={styles.body}>
        {t('onboard_restore.subheading',
           'Voer je herstelzin in (12 of 24 woorden, gescheiden door spaties).')}
      </Text>

      <TextInput
        value={phrase}
        onChangeText={setPhrase}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('onboard_restore.placeholder', 'twelve … words …')}
        style={styles.input}
        accessibilityLabel="restore-mnemonic-input"
      />

      <StatusLine status={status} />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        onPress={submit}
        disabled={!canSubmit}
        style={({ pressed }) => [
          styles.btnPrimary,
          (!canSubmit) && styles.btnDisabled,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="restore-submit"
      >
        <Text style={styles.btnPrimaryLabel}>
          {submitting
            ? t('onboard_restore.submitting', 'Bezig…')
            : t('onboard_restore.submit',     'Herstel')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function StatusLine({ status }) {
  if (status === 'empty') return null;
  if (status === 'looks_ok') {
    return (
      <Text style={[styles.statusText, styles.statusOk]}>
        {t('onboard_restore.status_looks_ok', 'Ziet er goed uit ✓')}
      </Text>
    );
  }
  const key = `onboard_restore.status_${status}`;
  return (
    <Text style={[styles.statusText, styles.statusWarn]}>
      {t(key, _fallbackForStatus(status))}
    </Text>
  );
}

function _fallbackForStatus(status) {
  switch (status) {
    case 'too_short':      return 'Voer meer woorden in.';
    case 'wrong_count':    return 'Een herstelzin is 12, 15, 18, 21 of 24 woorden.';
    case 'malformed_word': return 'Een woord lijkt niet kloppen — alleen kleine letters.';
    default:               return '';
  }
}

export default OnboardRestoreScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.xl, backgroundColor: COLORS.background, flexGrow: 1 },
  title: {
    fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text,
    marginTop: SPACING.lg,
  },
  body: {
    marginTop: SPACING.md,
    fontSize: FONT_SIZES.md, color: COLORS.textMuted, lineHeight: 22,
  },
  input: {
    marginTop: SPACING.lg, minHeight: 120, borderWidth: 1,
    borderColor: COLORS.border, borderRadius: RADII.sm,
    padding: SPACING.md, fontSize: FONT_SIZES.md,
    color: COLORS.text, textAlignVertical: 'top',
  },
  statusText: { marginTop: SPACING.sm, fontSize: FONT_SIZES.sm },
  statusOk:   { color: COLORS.success },
  statusWarn: { color: COLORS.warning },
  errorText: {
    marginTop: SPACING.sm,
    color: COLORS.danger, fontSize: FONT_SIZES.sm,
  },
  btnPrimary: {
    marginTop: SPACING.xl,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center',
  },
  btnDisabled: { backgroundColor: COLORS.surfaceMuted },
  btnPrimaryLabel: {
    color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600',
  },
  pressed: { opacity: 0.85 },
});

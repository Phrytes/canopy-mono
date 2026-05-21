/**
 * OnboardRestoreScreen — recovery-phrase mid-flight identity swap.
 *
 * Phase 41.3.3 (2026-05-09).
 *
 * Submits the typed/pasted phrase to a `restoreFromMnemonic` helper
 * that swaps the agent identity in the active vault, restarts the
 * meshAgent, and resets ServiceContext state. The plumbing for the
 * actual swap lives in ServiceContext (Phase 41.2 left a stub —
 * Phase 41.10's full Profile/recovery section ties this to
 * `getMnemonicOnce`).
 *
 * Phase 41.3 ships the SCREEN (input + status + submit) plus the
 * thin restore handler that calls AgentIdentity.fromMnemonic. The
 * full identity swap goes through ServiceContext's
 * `restoreIdentity({mnemonic})` method (added in this commit).
 */

import React, { useCallback, useState, useEffect } from 'react';
import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { statusFor } from '@canopy/react-native/mnemonic';
import { useTheme }  from '@canopy/react-native/theme';

import { useService } from '../ServiceContext.js';
import { useLocalisation }    from '../LocalisationProvider.js';
import { ROUTES }     from '../navigation.js';

export function OnboardRestoreScreen() {
  const nav   = useNavigation();
  const route = useRoute();
  const svc   = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const prefill = typeof route?.params?.prefill === 'string' ? route.params.prefill : '';
  const [phrase, setPhrase] = useState(prefill);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState(null);

  // Re-prefill if navigation passes a different value mid-mount.
  useEffect(() => {
    if (typeof route?.params?.prefill === 'string' && route.params.prefill !== phrase) {
      setPhrase(route.params.prefill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.prefill]);

  const status = statusFor(phrase);
  const canSubmit = status === 'looks_ok' && !busy;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (typeof svc?.restoreIdentity === 'function') {
        await svc.restoreIdentity({ mnemonic: phrase });
      } else {
        throw new Error('restoreIdentity not yet wired');
      }
      nav.navigate(ROUTES.Welcome);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [canSubmit, phrase, svc, nav]);

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        backgroundColor: COLORS.background,
        padding: SPACING.xl,
      }}
    >
      <Text style={{ fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md }}>
        {t('mobile.restore.title')}
      </Text>
      <Text style={{ fontSize: FONT_SIZES.md, color: COLORS.textMuted, lineHeight: 22, marginBottom: SPACING.lg }}>
        {t('mobile.restore.subtitle')}
      </Text>

      <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.text, fontWeight: '500', marginBottom: SPACING.sm }}>
        {t('mobile.restore.input_label')}
      </Text>
      <TextInput
        value={phrase}
        onChangeText={setPhrase}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('mobile.restore.input_label')}
        placeholderTextColor={COLORS.textMuted}
        accessibilityLabel="restore-mnemonic-input"
        style={{
          minHeight: 120,
          borderWidth: 1,
          borderColor: COLORS.border,
          borderRadius: RADII.sm,
          padding: SPACING.md,
          fontSize: FONT_SIZES.md,
          color: COLORS.text,
          backgroundColor: COLORS.surface,
          textAlignVertical: 'top',
          fontFamily: 'monospace',
        }}
      />

      <Text style={{
        marginTop: SPACING.sm,
        fontSize: FONT_SIZES.sm,
        color: status === 'looks_ok' ? COLORS.success : COLORS.textMuted,
      }}>
        {t(`mobile.restore.status_${status}`)}
      </Text>

      {error ? (
        <Text style={{ marginTop: SPACING.md, color: COLORS.danger, fontSize: FONT_SIZES.sm }}>
          {t('mobile.restore.restore_failed', null).replace('{reason}', error)}
        </Text>
      ) : null}

      <Pressable
        onPress={submit}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel="restore-submit"
        style={({ pressed }) => [
          {
            marginTop: SPACING.lg,
            paddingVertical: SPACING.lg,
            borderRadius: RADII.md,
            alignItems: 'center',
            backgroundColor: canSubmit ? COLORS.primary : COLORS.surfaceMuted,
          },
          pressed && canSubmit && { opacity: 0.8 },
        ]}
      >
        <Text style={{
          color: canSubmit ? COLORS.textInverse : COLORS.textMuted,
          fontSize: FONT_SIZES.md,
          fontWeight: '600',
        }}>
          {busy ? '…' : t('mobile.restore.submit')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

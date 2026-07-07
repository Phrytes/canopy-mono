/**
 * AuthCallbackScreen — bulk-sync progress bar after pod sign-in.
 *
 * Phase 41.15.2 (2026-05-09).
 *
 * Reachable via:
 *   - direct nav from PodSignInScreen after attachPod returns
 *   - the `tasks://auth/callback?...` deep link (parsed in App.js)
 *
 * Runs `svc.bulkSync({onProgress})` once on mount; surfaces progress
 * + a "Continue" CTA that returns to Workspace when the pull is done.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useLocalisation }    from '../LocalisationProvider.js';
import { ROUTES }     from '../navigation.js';

export function AuthCallbackScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const [stage,    setStage]    = useState('syncing'); // syncing | done | error
  const [progress, setProgress] = useState({ done: 0, total: null });
  const [error,    setError]    = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof svc?.bulkSync !== 'function') {
          if (!cancelled) setStage('done');
          return;
        }
        await svc.bulkSync((p) => {
          if (!cancelled) setProgress(p ?? { done: 0, total: null });
        });
        if (!cancelled) setStage('done');
      } catch (err) {
        if (!cancelled) {
          setError(err?.message ?? String(err));
          setStage('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [svc]);

  const onContinue = useCallback(() => {
    nav.navigate(svc?.circles?.size > 0 ? ROUTES.Workspace : ROUTES.Welcome);
  }, [nav, svc]);

  return (
    <View style={{
      flex: 1, backgroundColor: COLORS.background,
      padding: SPACING.xl, alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{
        fontSize: FONT_SIZES.xl, fontWeight: '600',
        color: COLORS.text, textAlign: 'center', marginBottom: SPACING.md,
      }}>
        {stage === 'syncing' ? t('mobile.auth_callback.syncing')
         : stage === 'done'   ? t('mobile.auth_callback.done')
                              : t('mobile.auth_callback.error')}
      </Text>

      {stage === 'syncing' ? (
        <>
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginBottom: SPACING.md }} />
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
            {progress.total
              ? t('mobile.auth_callback.progress_with_total', null)
                  .replace('{done}',  String(progress.done ?? 0))
                  .replace('{total}', String(progress.total))
              : t('mobile.auth_callback.progress_count', null)
                  .replace('{done}', String(progress.done ?? 0))}
          </Text>
        </>
      ) : null}

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md, textAlign: 'center' }}>
          {error}
        </Text>
      ) : null}

      {stage !== 'syncing' ? (
        <Pressable
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel="auth-callback-continue"
          style={{
            paddingVertical: SPACING.lg, paddingHorizontal: SPACING.xl,
            borderRadius: RADII.md, backgroundColor: COLORS.primary,
            marginTop: SPACING.md,
          }}
        >
          <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' }}>
            {t('mobile.auth_callback.continue')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

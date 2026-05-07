/**
 * AuthCallbackScreen — bulk-sync progress after pod sign-in.
 *
 * Stoop V3 Phase 40.19 (2026-05-08).  Mirrors `/auth-callback.html`
 * on the desktop: polls `getBulkSyncStatus` every ~500 ms and
 * renders a progress bar until the bulk-sync finishes.
 *
 * On 'idle' / 'done' / 'error', surfaces a CTA to navigate back
 * to the Feed (or stay if there's an error).
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/i18n.js';
import { useService }                         from '../ServiceContext.js';
import { useSkill }                           from '../lib/useSkill.js';

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS  = 5 * 60 * 1000; // give up after 5 min

export function AuthCallbackScreen() {
  const nav = useNavigation();
  const svc = useService();
  const getStatus = useSkill('getBulkSyncStatus');

  const [snap, setSnap]   = useState({ phase: 'loading', uploaded: 0, total: 0 });
  const [error, setError] = useState(null);

  // Polling loop.
  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    let timer = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await getStatus.call({});
        if (cancelled) return;
        setSnap(r ?? { phase: 'unknown' });
        const phase = r?.phase;
        const stop  = ['done', 'idle', 'error'].includes(phase)
                   || Date.now() - startedAt > POLL_TIMEOUT_MS;
        if (!stop) {
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err?.message ?? String(err));
        timer = setTimeout(tick, POLL_INTERVAL_MS * 2);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [getStatus]);

  if (!svc?.activeBundle) {
    return (
      <View style={styles.root}>
        <Text style={styles.body}>
          {t('auth_callback.no_active_group', 'Geen actieve bundle.')}
        </Text>
      </View>
    );
  }

  const total    = snap.total    ?? 0;
  const uploaded = snap.uploaded ?? snap.done ?? 0;
  const phase    = snap.phase    ?? 'loading';
  const pct      = total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : null;

  const goFeed = () => nav.navigate(ROUTES.Shell, { screen: ROUTES.Feed });

  return (
    <View style={styles.root}>
      <Text style={styles.heading}>
        {t('auth_callback.heading', 'Pod-aanmelding voltooien')}
      </Text>
      <Text style={styles.body}>
        {phase === 'running' || phase === 'starting' || phase === 'loading'
          ? t('auth_callback.uploading', 'Lokale data wordt geüpload naar je pod…')
          : phase === 'done' || phase === 'idle'
            ? t('auth_callback.done', 'Klaar.')
            : phase === 'error'
              ? t('auth_callback.error', 'Er ging iets mis tijdens de eerste sync.')
              : t('auth_callback.busy', 'Bezig met afronden van de OIDC-flow…')}
      </Text>

      {phase === 'running' || phase === 'starting' || phase === 'loading' ? (
        <ActivityIndicator style={{ marginVertical: SPACING.lg }} />
      ) : null}

      {pct != null && (phase === 'running' || phase === 'done') ? (
        <View style={styles.progressBlock}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.progressLabel}>
            {t('auth_callback.progress', '{done} van {total} ({pct}%)')
              .replace('{done}', String(uploaded))
              .replace('{total}', String(total))
              .replace('{pct}',   String(pct))}
          </Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable onPress={goFeed} style={styles.btnPrimary} accessibilityRole="button">
        <Text style={styles.btnPrimaryLabel}>
          {phase === 'done' || phase === 'idle'
            ? t('auth_callback.go_feed', 'Naar Prikbord')
            : t('auth_callback.skip',     'Sluit en ga naar Prikbord')}
        </Text>
      </Pressable>
    </View>
  );
}

export default AuthCallbackScreen;

const styles = StyleSheet.create({
  root: { flex: 1, padding: SPACING.lg, backgroundColor: COLORS.background },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  body:    { fontSize: FONT_SIZES.md, color: COLORS.textMuted, lineHeight: 22, marginBottom: SPACING.lg },
  progressBlock: { marginVertical: SPACING.lg },
  progressTrack: {
    height: 8, backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADII.sm, overflow: 'hidden',
  },
  progressFill: { height: 8, backgroundColor: COLORS.primary },
  progressLabel: {
    marginTop: SPACING.sm, fontSize: FONT_SIZES.sm, color: COLORS.textMuted,
  },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginVertical: SPACING.md },
  btnPrimary: {
    marginTop: SPACING.lg, backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center',
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
});

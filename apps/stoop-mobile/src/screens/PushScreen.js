/**
 * PushScreen — opt-in flow for native push.
 *
 * Stoop V3 Phase 40.19 (2026-05-08): wired to the live agent.
 *
 *   1. requestPushPermission → ask the OS for permission.
 *   2. setupPush(agent, projectId) → register an `ExpoNotificationsAdapter`
 *      via the substrate's `MobilePushBridge`, get the device token.
 *   3. subscribeWebPush({subscription}) → ship the token to the
 *      relay so it can wake this device. The substrate accepts an
 *      Expo-shaped subscription `{endpoint: 'expo://<token>',
 *      keys: {...}}`.
 *   4. triggerSelfPush — convenience "test push" CTA.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/localisation.js';
import { requestPushPermission, setupPush }   from '../lib/push.js';
import { useService }                         from '../ServiceContext.js';
import { useSkill }                           from '../lib/useSkill.js';

export function PushScreen() {
  const svc = useService();
  const subscribe = useSkill('subscribeWebPush');
  const testPush  = useSkill('triggerSelfPush');

  const [status, setStatus] = useState({ kind: 'unknown' });
  const [busy, setBusy]     = useState(false);

  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const perm = await requestPushPermission();
      if (!perm.granted) {
        setStatus({ kind: 'denied' });
        return;
      }
      const agent = svc?.activeBundle?.agent;
      if (!agent) {
        setStatus({ kind: 'granted_no_agent' });
        return;
      }
      const r = await setupPush({ agent, onError: (err) => {
        setStatus({ kind: 'error', message: err?.message ?? String(err) });
      } });
      if (!r.token) {
        setStatus((cur) => cur.kind === 'error' ? cur : { kind: 'no_token' });
        return;
      }

      // Ship the token to the relay via subscribeWebPush.  The
      // substrate-side relay accepts the Expo-shaped subscription
      // (endpoint = `expo://<token>`); the desktop side ships
      // `https://<vapid-endpoint>` instead.
      try {
        await subscribe.call({
          subscription: {
            endpoint: `expo://${r.token}`,
            platform: r.platform,
            keys:     {},
          },
        });
      } catch (err) {
        // Token still got captured locally; user can retry by
        // tapping the test-push button.
        console.warn('[PushScreen] subscribeWebPush failed:', err?.message ?? err);
      }

      setStatus({ kind: 'enabled', token: r.token, platform: r.platform });
    } catch (err) {
      setStatus({ kind: 'error', message: err?.message ?? String(err) });
    } finally {
      setBusy(false);
    }
  }, [svc, subscribe]);

  const sendTest = useCallback(async () => {
    try {
      await testPush.call({ title: 'Stoop', body: t('push.test_body', 'Test-melding') });
    } catch { /* surfaced by testPush.error if needed */ }
  }, [testPush]);

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>
        {t('push.heading', 'Push-meldingen')}
      </Text>
      <Text style={styles.body}>
        {t('mobile.permission_push_rationale',
           'Stoop wil je een melding sturen wanneer iemand reageert op je post of een nieuw bericht stuurt.')}
      </Text>

      <Pressable
        onPress={enable}
        disabled={busy || status.kind === 'enabled'}
        style={({ pressed }) => [
          styles.btnPrimary,
          (busy || status.kind === 'enabled') && styles.btnDisabled,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="push-enable"
      >
        <Text style={styles.btnPrimaryLabel}>
          {busy
            ? t('push.enabling', 'Inschakelen…')
            : status.kind === 'enabled'
              ? t('push.enabled', 'Aan')
              : t('push.enable',  'Schakel meldingen in')}
        </Text>
      </Pressable>

      {status.kind === 'enabled' ? (
        <Pressable
          onPress={sendTest}
          disabled={testPush.loading}
          style={styles.btnSecondary}
          accessibilityRole="button"
          accessibilityLabel="push-send-test"
        >
          <Text style={styles.btnSecondaryLabel}>
            {testPush.loading
              ? t('push.test_sending', 'Test-push verstuurd…')
              : t('push.test',         'Test-melding sturen')}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.statusBlock}>
        <Status status={status} />
      </View>
    </ScrollView>
  );
}

function Status({ status }) {
  switch (status.kind) {
    case 'unknown':
      return <Text style={styles.statusUnknown}>
        {t('push.status_unknown', 'Nog niet ingeschakeld.')}
      </Text>;
    case 'denied':
      return <Text style={styles.statusError}>
        {t('push.status_denied', 'Toestemming geweigerd. Schakel meldingen in via Instellingen.')}
      </Text>;
    case 'granted_no_agent':
      return <Text style={styles.statusUnknown}>
        {t('push.status_granted_no_agent', 'Toestemming OK. Wacht op agent-bringup.')}
      </Text>;
    case 'no_token':
      return <Text style={styles.statusError}>
        {t('push.status_no_token', 'Geen token ontvangen. Probeer opnieuw.')}
      </Text>;
    case 'enabled':
      return (
        <View>
          <Text style={styles.statusOk}>{t('push.status_enabled', 'Meldingen staan aan ✓')}</Text>
          <Text style={styles.tokenText} numberOfLines={1} selectable>{status.token}</Text>
        </View>
      );
    case 'error':
      return <Text style={styles.statusError}>{status.message}</Text>;
    default:
      return null;
  }
}

export default PushScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  body:    { fontSize: FONT_SIZES.md, color: COLORS.textMuted, lineHeight: 22, marginBottom: SPACING.lg },
  btnPrimary: {
    backgroundColor: COLORS.primary, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center',
  },
  btnDisabled:     { backgroundColor: COLORS.surfaceMuted },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted, paddingVertical: SPACING.md,
    borderRadius: RADII.sm, alignItems: 'center', marginTop: SPACING.md,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  pressed: { opacity: 0.85 },
  statusBlock: {
    marginTop: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  statusUnknown: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
  statusOk:      { color: COLORS.success,   fontSize: FONT_SIZES.sm, fontWeight: '600' },
  statusError:   { color: COLORS.danger,    fontSize: FONT_SIZES.sm },
  tokenText: {
    marginTop: SPACING.sm, fontFamily: 'monospace',
    fontSize: FONT_SIZES.xs, color: COLORS.textMuted,
  },
});

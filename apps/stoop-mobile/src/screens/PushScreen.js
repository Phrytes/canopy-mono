/**
 * PushScreen — opt-in flow for native push.
 *
 * Stoop V3 mobile.  Wraps the `lib/push.js` helpers — caller wires
 * the agent + EAS projectId; the screen drives `requestPushPermission`
 * + `setupPush` on tap and surfaces the resulting token / permission
 * status to the user.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/i18n.js';
import { requestPushPermission, setupPush }   from '../lib/push.js';

/**
 * @param {object} props
 * @param {object} [props.agent]       live `Agent` (from bring-up code).
 * @param {string} [props.projectId]
 * @param {(token: string) => Promise<void>} [props.onTokenReady]
 *   Bring-up code uses this to ship the token to a relay/backend.
 */
export function PushScreen({ agent, projectId, onTokenReady } = {}) {
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
      if (!agent) {
        setStatus({ kind: 'granted_no_agent' });
        return;
      }
      const r = await setupPush({ agent, projectId, onError: (err) => {
        setStatus({ kind: 'error', message: err?.message ?? String(err) });
      } });
      if (!r.token) {
        setStatus((cur) => cur.kind === 'error' ? cur : { kind: 'no_token' });
        return;
      }
      setStatus({ kind: 'enabled', token: r.token, platform: r.platform });
      if (onTokenReady) await onTokenReady(r.token);
    } catch (err) {
      setStatus({ kind: 'error', message: err?.message ?? String(err) });
    } finally {
      setBusy(false);
    }
  }, [agent, projectId, onTokenReady]);

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
          <Text style={styles.tokenText} numberOfLines={1} selectable>
            {status.token}
          </Text>
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

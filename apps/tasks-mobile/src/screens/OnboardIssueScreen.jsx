/**
 * OnboardIssueScreen — admin generates an invite QR for someone else.
 *
 * Phase 41.3.4 (2026-05-09).
 *
 * Calls `issueInvite({ttlMs, role})` via the active crew, encodes the
 * payload as `tasks://invite?token=<base64url-json>`, renders via
 * `<QrCodeView>` from `@canopy/react-native/qr/view`.
 *
 * Reachable from CrewSettings (Phase 41.8) — the V1 UI doesn't link
 * here from Welcome since you need an active admin role first.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';

import { useTheme } from '@canopy/react-native/theme';
import { QrCodeView } from '@canopy/react-native/qr/view';

import { useSkill } from '../lib/useSkill.js';
import { useLocalisation }  from '../LocalisationProvider.js';

const TTL_SHORT = 60 * 60 * 1000;        // 1 hour
const TTL_LONG  = 24 * 60 * 60 * 1000;   // 24 hours

function _b64urlJson(obj) {
  const json = JSON.stringify(obj);
  // Browser/Hermes: btoa(unicode-safe).
  if (typeof btoa === 'function') {
    const bin = unescape(encodeURIComponent(json));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // Node fallback (vitest).
  return Buffer.from(json, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Encode an invite token into a `tasks://invite?token=<...>` URL.
 * Exported separately so tests + screens both reach it without
 * pulling in the JSX component file.
 */
export function encodeInviteUrl(token) {
  return `tasks://invite?token=${_b64urlJson(token)}`;
}

export function OnboardIssueScreen() {
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const issue = useSkill('issueInvite');
  const [ttlMs, setTtlMs] = useState(TTL_SHORT);
  const [role,  setRole]  = useState('member');
  const [token, setToken] = useState(null);
  const [error, setError] = useState(null);

  const generate = useCallback(async () => {
    setError(null);
    try {
      const r = await issue.call({ ttlMs, role });
      if (r?.error) {
        setError(r.error);
        return;
      }
      setToken(r?.invite ?? null);
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [issue, ttlMs, role]);

  // Auto-generate on mount + when TTL/role changes.
  useEffect(() => { generate(); }, [generate]);

  const url = token ? encodeInviteUrl(token) : null;

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        backgroundColor: COLORS.background,
        padding: SPACING.xl,
      }}
    >
      <Text style={{ fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md }}>
        {t('mobile.issue.title')}
      </Text>
      <Text style={{ fontSize: FONT_SIZES.md, color: COLORS.textMuted, lineHeight: 22, marginBottom: SPACING.lg }}>
        {t('mobile.issue.subtitle')}
      </Text>

      <View style={{ flexDirection: 'row', marginBottom: SPACING.md }}>
        <Pressable
          onPress={() => setTtlMs(TTL_SHORT)}
          style={[styles.chip(COLORS, SPACING, RADII), ttlMs === TTL_SHORT && styles.chipActive(COLORS)]}
          accessibilityRole="button"
          accessibilityState={{ selected: ttlMs === TTL_SHORT }}
        >
          <Text style={{ color: ttlMs === TTL_SHORT ? COLORS.textInverse : COLORS.text, fontSize: FONT_SIZES.sm }}>
            {t('mobile.issue.ttl_short')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTtlMs(TTL_LONG)}
          style={[styles.chip(COLORS, SPACING, RADII), ttlMs === TTL_LONG && styles.chipActive(COLORS)]}
          accessibilityRole="button"
          accessibilityState={{ selected: ttlMs === TTL_LONG }}
        >
          <Text style={{ color: ttlMs === TTL_LONG ? COLORS.textInverse : COLORS.text, fontSize: FONT_SIZES.sm }}>
            {t('mobile.issue.ttl_long')}
          </Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', marginBottom: SPACING.lg }}>
        <Pressable
          onPress={() => setRole('member')}
          style={[styles.chip(COLORS, SPACING, RADII), role === 'member' && styles.chipActive(COLORS)]}
          accessibilityRole="button"
          accessibilityState={{ selected: role === 'member' }}
        >
          <Text style={{ color: role === 'member' ? COLORS.textInverse : COLORS.text, fontSize: FONT_SIZES.sm }}>
            {t('mobile.issue.role_member')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setRole('admin')}
          style={[styles.chip(COLORS, SPACING, RADII), role === 'admin' && styles.chipActive(COLORS)]}
          accessibilityRole="button"
          accessibilityState={{ selected: role === 'admin' }}
        >
          <Text style={{ color: role === 'admin' ? COLORS.textInverse : COLORS.text, fontSize: FONT_SIZES.sm }}>
            {t('mobile.issue.role_admin')}
          </Text>
        </Pressable>
      </View>

      {url ? (
        <View style={{ alignItems: 'center', marginVertical: SPACING.lg }}>
          <QrCodeView value={url} size={240} />
        </View>
      ) : null}

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md }}>
          {t('mobile.issue.issue_failed', null).replace('{reason}', error)}
        </Text>
      ) : null}

      <Pressable
        onPress={generate}
        accessibilityRole="button"
        accessibilityLabel="issue-regenerate"
        style={({ pressed }) => [
          {
            paddingVertical: SPACING.md,
            borderRadius: RADII.md,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: COLORS.surface,
          },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' }}>
          {t('mobile.issue.regenerate')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = {
  chip: (COLORS, SPACING, RADII) => ({
    paddingVertical:   SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius:      RADII.pill,
    borderWidth:       1,
    borderColor:       COLORS.border,
    backgroundColor:   COLORS.surface,
    marginRight:       SPACING.sm,
  }),
  chipActive: (COLORS) => ({
    backgroundColor: COLORS.primary,
    borderColor:     COLORS.primaryDark,
  }),
};

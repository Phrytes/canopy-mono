/**
 * SettingsScreen — per-device + shared settings + push opt-in.
 *
 * Phase 41.11 (2026-05-09).
 *
 * Two sections:
 *   - per-device: pollIntervalMs, allowHopThrough, calendarSyncMethod
 *   - shared:     pushPreferences (per-event toggles)
 *
 * Push opt-in uses the substrate's usePushOptIn hook (Phase 41.0 L6
 * lift). The token-change callback is wired to a logger here for V1;
 * the actual relay-side registration is per-app and lands when the
 * push registry / pod-side relay is in place.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, Switch, TextInput, ScrollView, Pressable } from 'react-native';

import { useTheme } from '@canopy/react-native/theme';
import { usePushOptIn } from '@canopy/react-native/push';

import { useService } from '../ServiceContext.js';
import { useSettings } from '../lib/useSkill.js';
import { useI18n }     from '../I18nProvider.js';

const POLL_PRESETS = [2000, 5000, 10000, 30000];

export function SettingsScreen() {
  const svc = useService();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const settingsHook = useSettings();
  const settings = settingsHook?.settings ?? null;

  const push = usePushOptIn({
    agent: svc?.meshAgent,
    onTokenChange: (token, platform) => {
      // V1: log only. Real relay-side registration lands when the
      // push-registry pod path is wired.
      // eslint-disable-next-line no-console
      console.log('[push] token registered', platform, token?.slice(0, 12) ?? '?');
    },
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.warn('[push] error', err?.message ?? err);
    },
  });

  const updateDevice = useCallback((patch) => {
    settingsHook.update(patch, 'device').catch(() => {});
  }, [settingsHook]);
  const updateShared = useCallback((patch) => {
    settingsHook.update(patch, 'shared').catch(() => {});
  }, [settingsHook]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.lg }}
    >
      <Section title={t('mobile.settings.section_device')} colors={COLORS} sp={SPACING} fz={FONT_SIZES}>
        <Field label={t('mobile.settings.poll_interval')} colors={COLORS} sp={SPACING} fz={FONT_SIZES}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            {POLL_PRESETS.map((ms) => {
              const active = settings?.pollIntervalMs === ms;
              return (
                <Pressable
                  key={ms}
                  onPress={() => updateDevice({ pollIntervalMs: ms })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{
                    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                    borderRadius: RADII.pill,
                    backgroundColor: active ? COLORS.primary : COLORS.surface,
                    borderWidth: 1,
                    borderColor: active ? COLORS.primaryDark : COLORS.border,
                  }}
                >
                  <Text style={{
                    color: active ? COLORS.textInverse : COLORS.text,
                    fontSize: FONT_SIZES.sm,
                  }}>
                    {Math.round(ms / 1000)}s
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Toggle
          label={t('mobile.settings.allow_hop_through')}
          value={!!settings?.allowHopThrough}
          onChange={(v) => updateDevice({ allowHopThrough: v })}
          accessibilityLabel="settings-hop-through"
          colors={COLORS} sp={SPACING} fz={FONT_SIZES}
        />

        <Field label={t('mobile.settings.calendar_sync_method')} colors={COLORS} sp={SPACING} fz={FONT_SIZES}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            {['ics', 'native', 'both'].map((m) => {
              const active = (settings?.calendarSyncMethod ?? 'ics') === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => updateDevice({ calendarSyncMethod: m })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{
                    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                    borderRadius: RADII.pill,
                    backgroundColor: active ? COLORS.primary : COLORS.surface,
                    borderWidth: 1,
                    borderColor: active ? COLORS.primaryDark : COLORS.border,
                  }}
                >
                  <Text style={{
                    color: active ? COLORS.textInverse : COLORS.text,
                    fontSize: FONT_SIZES.sm,
                  }}>
                    {t(`mobile.settings.calendar_${m}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>
      </Section>

      <Section title={t('mobile.settings.section_push')} colors={COLORS} sp={SPACING} fz={FONT_SIZES}>
        <View style={{
          flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: SPACING.md,
        }}>
          <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md }}>
            {push.status === 'granted' ? t('mobile.settings.push_subscribed', null).replace('{platform}', push.platform ?? '?')
              : push.status === 'denied' ? t('mobile.settings.push_denied')
              : t('mobile.settings.push_not_subscribed')}
          </Text>
          {push.status === 'granted' ? (
            <Pressable
              onPress={() => push.teardown().catch(() => {})}
              accessibilityRole="button"
              accessibilityLabel="settings-push-unsubscribe"
              style={{
                paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                borderRadius: RADII.pill, borderWidth: 1, borderColor: COLORS.border,
              }}
            >
              <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
                {t('mobile.settings.push_unsubscribe')}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => push.request().catch(() => {})}
              accessibilityRole="button"
              accessibilityLabel="settings-push-subscribe"
              disabled={push.status === 'requesting' || !svc?.meshAgent}
              style={{
                paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                borderRadius: RADII.pill,
                backgroundColor: COLORS.primary,
              }}
            >
              <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '600' }}>
                {push.status === 'requesting' ? '…' : t('mobile.settings.push_subscribe')}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Per-event toggles map to pushPreferences in shared settings. */}
        {['deadlineApproaching', 'taskClaimed', 'taskRejected', 'subtaskProposal'].map((evt) => (
          <Toggle
            key={evt}
            label={t(`mobile.settings.push_event_${evt}`)}
            value={settings?.pushPreferences?.[evt] !== false}
            onChange={(v) => updateShared({
              pushPreferences: { ...(settings?.pushPreferences ?? {}), [evt]: v },
            })}
            accessibilityLabel={`settings-push-event-${evt}`}
            colors={COLORS} sp={SPACING} fz={FONT_SIZES}
          />
        ))}
      </Section>

      {push.error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.sm }}>
          {String(push.error?.message ?? push.error)}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Section({ title, children, colors, sp, fz }) {
  return (
    <View style={{ marginBottom: sp.xl }}>
      <Text style={{
        fontSize: fz.md, fontWeight: '600', color: colors.text,
        marginBottom: sp.md,
      }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Field({ label, children, colors, sp, fz }) {
  return (
    <View style={{ marginBottom: sp.md }}>
      <Text style={{ fontSize: fz.sm, color: colors.textMuted, marginBottom: sp.sm }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function Toggle({ label, value, onChange, accessibilityLabel, colors, sp, fz }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: sp.sm,
    }}>
      <Text style={{ color: colors.text, fontSize: fz.sm, flex: 1, marginRight: sp.md }}>
        {label}
      </Text>
      <Switch value={!!value} onValueChange={onChange} accessibilityLabel={accessibilityLabel} />
    </View>
  );
}

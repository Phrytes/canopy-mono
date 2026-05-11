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
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { usePushOptIn } from '@canopy/react-native/push';

import { useService } from '../ServiceContext.js';
import { useSettings, useSkill } from '../lib/useSkill.js';
import { useI18n }     from '../I18nProvider.js';
import { ROUTES }      from '../navigation.js';
import { useNativeCalendarLiveSync } from '../lib/useNativeCalendarLiveSync.js';

const APP_KEY = 'tasks';

// expo-calendar is loaded lazily so vitest (which runs in a Node
// env without the native module) doesn't choke on the import. The
// hook gracefully degrades when CalendarModule is null.
let _CalendarModule = null;
try { _CalendarModule = require('expo-calendar'); } catch { /* test env */ }
let _Storage = null;
try { _Storage = require('@react-native-async-storage/async-storage')?.default ?? null; }
catch { /* test env */ }

const POLL_PRESETS = [2000, 5000, 10000, 30000];

export function SettingsScreen() {
  const svc = useService();
  const nav = useNavigation();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const settingsHook = useSettings();
  const settings = settingsHook?.settings ?? null;

  // 41.18.5 — register the Expo push token on the active crew via
  // the new `setMyPushToken` skill. Token rotation re-fires this
  // callback; an empty token unregisters this app's entry.
  const setMyPushToken = useSkill('setMyPushToken');

  // 41.18.5 — native calendar live diff. Fires whenever listMine
  // emits a change; only enabled when the user has chosen native or
  // both as the calendar sync method.
  const calendarSyncMethod = settings?.calendarSyncMethod ?? 'ics';
  const liveCal = useNativeCalendarLiveSync({
    enabled:        calendarSyncMethod === 'native' || calendarSyncMethod === 'both',
    CalendarModule: _CalendarModule,
    storage:        _Storage,
  });

  const push = usePushOptIn({
    agent: svc?.meshAgent,
    onTokenChange: (token, platform) => {
      // eslint-disable-next-line no-console
      console.log('[push] token registered', platform, token?.slice(0, 12) ?? '?');
      setMyPushToken.call({
        pushToken: token ?? '',
        platform:  platform ?? 'expo',
        appKey:    APP_KEY,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[push] register-skill failed', err?.message ?? err);
      });
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

        {(calendarSyncMethod === 'native' || calendarSyncMethod === 'both') ? (
          <View style={{ marginBottom: SPACING.md }}>
            <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}>
              {liveCal.error ? (
                t('mobile.settings.calendar_live_error', null).replace('{err}', liveCal.error)
              ) : liveCal.lastSyncMs ? (
                t('mobile.settings.calendar_live_last_sync', null)
                  .replace('{when}', new Date(liveCal.lastSyncMs).toLocaleTimeString())
              ) : (
                t('mobile.settings.calendar_live_pending')
              )}
            </Text>
          </View>
        ) : null}

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

      <Section title={t('mobile.settings.section_more')} colors={COLORS} sp={SPACING} fz={FONT_SIZES}>
        <NavRow
          label={t('mobile.settings.cadence_link')}
          hint={t('mobile.settings.cadence_hint')}
          onPress={() => nav.navigate(ROUTES.CadenceOverrides)}
          colors={COLORS} sp={SPACING} fz={FONT_SIZES} radii={RADII}
        />
        <NavRow
          label={t('mobile.settings.diagnostics_link')}
          hint={t('mobile.settings.diagnostics_hint')}
          onPress={() => nav.navigate(ROUTES.Metrics)}
          colors={COLORS} sp={SPACING} fz={FONT_SIZES} radii={RADII}
        />
        <NavRow
          label={t('mobile.settings.privacy_link')}
          hint={t('mobile.settings.privacy_hint')}
          onPress={() => nav.navigate(ROUTES.Privacy)}
          colors={COLORS} sp={SPACING} fz={FONT_SIZES} radii={RADII}
        />
      </Section>
    </ScrollView>
  );
}

function NavRow({ label, hint, onPress, colors, sp, fz, radii }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`settings-nav-${label}`}
      style={({ pressed }) => [
        {
          paddingVertical: sp.md,
          paddingHorizontal: sp.md,
          borderRadius: radii.sm,
          borderWidth: 1, borderColor: colors.border,
          backgroundColor: colors.surface,
          marginBottom: sp.sm,
        },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={{ color: colors.text, fontSize: fz.md, fontWeight: '500' }}>
        {label}
      </Text>
      {hint ? (
        <Text style={{ color: colors.textMuted, fontSize: fz.xs, marginTop: 4 }}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
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

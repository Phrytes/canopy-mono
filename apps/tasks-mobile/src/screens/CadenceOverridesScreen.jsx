/**
 * CadenceOverridesScreen — per-user cadence overrides for the active crew.
 *
 * Phase 41.18.3 (2026-05-10).
 *
 * Wraps `getMyCadenceOverrides` + `setMyCadenceOverrides` and surfaces
 * `resolveMyCadence` for one event so the user can preview the
 * effective cadence (user > crew > baseline) without guessing.
 *
 * V1 surface: a tiny grid of (eventType × intervalMs) text inputs.
 * Cadences are sparse — only the entries the user wants to override
 * land in the map.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useSkill, useSkillResult } from '../lib/useSkill.js';
import { useLocalisation }    from '../LocalisationProvider.js';

const KNOWN_EVENTS = [
  'deadlineApproaching',
  'taskClaimed',
  'taskRejected',
  'subtaskProposal',
  'subtaskRequested',
  'inboxBadge',
];

export function CadenceOverridesScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const cur     = useSkillResult('getMyCadenceOverrides', {}, [svc?.activeCircleId]);
  const setSk   = useSkill('setMyCadenceOverrides');
  const resolve = useSkill('resolveMyCadence');

  const [draft, setDraft]     = useState(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [resolved, setResolved] = useState({}); // eventType → effective ms

  useEffect(() => {
    if (cur?.data && draft == null) {
      setDraft({ ...(cur.data.overrides ?? {}) });
    }
  }, [cur?.data, draft]);

  // Resolve effective cadence for each known event the user has touched.
  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    (async () => {
      const out = {};
      for (const evt of KNOWN_EVENTS) {
        try {
          const r = await resolve.call({ eventType: evt });
          if (cancelled) return;
          out[evt] = r?.resolved ?? null;
        } catch { /* swallow */ }
      }
      if (!cancelled) setResolved(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const onChangeMs = useCallback((evt, raw) => {
    setDraft((prev) => {
      const next = { ...(prev ?? {}) };
      const trimmed = (raw ?? '').trim();
      if (trimmed === '') {
        delete next[evt];
      } else {
        const ms = Number(trimmed);
        if (Number.isFinite(ms) && ms >= 0) {
          next[evt] = { intervalMs: ms };
        }
      }
      return next;
    });
  }, []);

  const onSave = useCallback(async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await setSk.call({ overrides: draft });
      if (r?.error) {
        setError(String(r.error));
        return;
      }
      nav.goBack();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, setSk, nav, busy]);

  const rows = useMemo(() => KNOWN_EVENTS, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.lg }}
    >
      <Text style={{
        fontSize: FONT_SIZES.lg, fontWeight: '600', color: COLORS.text,
        marginBottom: SPACING.md,
      }}>
        {t('mobile.cadence.title')}
      </Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginBottom: SPACING.lg }}>
        {t('mobile.cadence.intro')}
      </Text>

      {rows.map((evt) => {
        const override = draft?.[evt]?.intervalMs;
        const eff      = resolved[evt]?.intervalMs;
        return (
          <View key={evt} style={{ marginBottom: SPACING.md }}>
            <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm, fontWeight: '500' }}>
              {t(`mobile.cadence.event_${evt}`, evt)}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: SPACING.xs }}>
              <TextInput
                value={override == null ? '' : String(override)}
                onChangeText={(s) => onChangeMs(evt, s)}
                placeholder={t('mobile.cadence.placeholder_override')}
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                autoCorrect={false}
                accessibilityLabel={`cadence-override-${evt}`}
                style={{
                  flex: 1,
                  borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
                  padding: SPACING.sm, fontSize: FONT_SIZES.md, color: COLORS.text,
                  backgroundColor: COLORS.surface,
                  marginRight: SPACING.sm,
                }}
              />
              <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, width: 110 }}>
                {t('mobile.cadence.effective', null)
                  .replace('{ms}', eff == null ? '—' : String(eff))}
              </Text>
            </View>
          </View>
        );
      })}

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md }}>
          {error}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACING.md }}>
        <Pressable
          onPress={() => nav.goBack()}
          accessibilityRole="button"
          style={{
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
            borderRadius: RADII.sm, marginRight: SPACING.sm,
            backgroundColor: COLORS.surfaceMuted,
          }}
        >
          <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md }}>
            {t('mobile.common.cancel')}
          </Text>
        </Pressable>
        <Pressable
          onPress={onSave}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="cadence-save"
          style={{
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
            borderRadius: RADII.sm,
            backgroundColor: busy ? COLORS.surfaceMuted : COLORS.primary,
          }}
        >
          <Text style={{
            color: busy ? COLORS.textMuted : COLORS.textInverse,
            fontSize: FONT_SIZES.md, fontWeight: '600',
          }}>
            {busy ? '…' : t('mobile.common.save')}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

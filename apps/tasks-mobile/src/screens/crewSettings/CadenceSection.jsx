/**
 * CadenceSection — admin-only crew-wide cadence config.
 *
 * Phase 41.18.3 (2026-05-10).
 *
 * Wraps `getCrewCadences` + `setCrewCadences`. Same shape as
 * CadenceOverridesScreen but on the crew-side configuration —
 * admin/coordinator only per the underlying skill's gating.
 *
 * V1 surface: per-event intervalMs text input, sparse map saved
 * verbatim on Save.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';

import { useTheme }    from '@canopy/react-native/theme';
import { useService } from '../../ServiceContext.js';
import { useSkill, useSkillResult } from '../../lib/useSkill.js';
import { useLocalisation }     from '../../LocalisationProvider.js';
import { useActiveRole } from '../../lib/useActiveRole.js';

const KNOWN_EVENTS = [
  'deadlineApproaching',
  'taskClaimed',
  'taskRejected',
  'subtaskProposal',
  'subtaskRequested',
  'inboxBadge',
];

export function CadenceSection() {
  const svc = useService();
  const { isAdmin } = useActiveRole();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const cur   = useSkillResult('getCrewCadences', {}, [svc?.activeCircleId]);
  const setSk = useSkill('setCrewCadences');

  const [draft, setDraft] = useState(null);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (cur?.data && draft == null) {
      setDraft({ ...(cur.data.cadences ?? {}) });
    }
  }, [cur?.data, draft]);

  const onChangeMs = useCallback((evt, raw) => {
    setDirty(true);
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
      const r = await setSk.call({ cadences: draft });
      if (r?.error) {
        setError(String(r.error));
        return;
      }
      setDirty(false);
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, setSk, busy]);

  if (!isAdmin) {
    return (
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
        {t('mobile.crew_settings.admin_only')}
      </Text>
    );
  }

  return (
    <View>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginBottom: SPACING.sm }}>
        {t('mobile.crew_settings.cadence_intro')}
      </Text>
      {KNOWN_EVENTS.map((evt) => {
        const value = draft?.[evt]?.intervalMs;
        return (
          <View key={evt} style={{ marginBottom: SPACING.sm }}>
            <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm, fontWeight: '500' }}>
              {t(`mobile.cadence.event_${evt}`, evt)}
            </Text>
            <TextInput
              value={value == null ? '' : String(value)}
              onChangeText={(s) => onChangeMs(evt, s)}
              placeholder={t('mobile.cadence.placeholder_crew')}
              placeholderTextColor={COLORS.textMuted}
              keyboardType="numeric"
              autoCorrect={false}
              accessibilityLabel={`cadence-crew-${evt}`}
              style={{
                marginTop: SPACING.xs,
                borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
                padding: SPACING.sm, fontSize: FONT_SIZES.md, color: COLORS.text,
                backgroundColor: COLORS.surface,
              }}
            />
          </View>
        );
      })}

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.sm }}>
          {error}
        </Text>
      ) : null}

      <Pressable
        onPress={onSave}
        disabled={busy || !dirty}
        accessibilityRole="button"
        accessibilityLabel="cadence-crew-save"
        style={{
          marginTop: SPACING.md,
          alignSelf: 'flex-start',
          paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
          borderRadius: RADII.sm,
          backgroundColor: (busy || !dirty) ? COLORS.surfaceMuted : COLORS.primary,
        }}
      >
        <Text style={{
          color: (busy || !dirty) ? COLORS.textMuted : COLORS.textInverse,
          fontSize: FONT_SIZES.md, fontWeight: '600',
        }}>
          {busy ? '…' : t('mobile.common.save')}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * PlannerCards — V2.4 schedule-suggestion panel.
 *
 * Phase 41.5.2 (2026-05-09).
 *
 * "Suggest a plan" button → `suggestSchedule` skill → renders the
 * top-3 suggestions as cards with a reason chip + Accept / Skip
 * buttons. Accept calls `acceptSchedule({taskId, slotStart, slotEnd})`
 * which sets `task.scheduledAt` (V2.1's calendar emission picks it
 * up automatically). Skip just removes the card from the local list.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from '@canopy/react-native/theme';
import { useSkill } from '../lib/useSkill.js';
import { useLocalisation }  from '../LocalisationProvider.js';

const REASON_KEYS = {
  'overdue':                'mobile.planner.reason_overdue',
  'last-chance':            'mobile.planner.reason_last_chance',
  'fits before deadline':   'mobile.planner.reason_fits',
  'no slot':                'mobile.planner.reason_no_slot',
};

export function PlannerCards() {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const { t } = useLocalisation();

  const suggest = useSkill('suggestSchedule');
  const accept  = useSkill('acceptSchedule');

  const [suggestions, setSuggestions] = useState(null); // null = not requested yet
  const [error, setError]   = useState(null);

  const onSuggest = useCallback(async () => {
    setError(null);
    try {
      const r = await suggest.call({});
      if (r?.error) {
        setError(r.error);
        setSuggestions([]);
        return;
      }
      const arr = Array.isArray(r?.suggestions) ? r.suggestions.slice(0, 3) : [];
      setSuggestions(arr);
    } catch (err) {
      setError(err?.message ?? String(err));
      setSuggestions([]);
    }
  }, [suggest]);

  const onAccept = useCallback(async (s) => {
    try {
      await accept.call({
        taskId:    s.taskId,
        slotStart: s.slotStart,
        slotEnd:   s.slotEnd,
      });
      setSuggestions((prev) => (prev ?? []).filter((it) => it !== s));
    } catch { /* swallow — UI already shows the panel */ }
  }, [accept]);

  const onSkip = useCallback((s) => {
    setSuggestions((prev) => (prev ?? []).filter((it) => it !== s));
  }, []);

  return (
    <View style={{
      backgroundColor: COLORS.surface,
      borderColor:     COLORS.border,
      borderWidth:     1,
      borderRadius:    RADII.md,
      padding:         SPACING.md,
      marginBottom:    SPACING.md,
    }}>
      <Text style={{
        fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text,
        marginBottom: SPACING.sm,
      }}>
        {t('mobile.planner.panel_title')}
      </Text>

      {suggestions === null ? (
        <Pressable
          onPress={onSuggest}
          accessibilityRole="button"
          accessibilityLabel="planner-suggest-cta"
          style={({ pressed }) => [
            {
              alignSelf: 'flex-start',
              paddingVertical: SPACING.sm,
              paddingHorizontal: SPACING.md,
              borderRadius: RADII.pill,
              backgroundColor: COLORS.primary,
            },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '600' }}>
            {suggest.loading ? t('mobile.planner.loading') : t('mobile.planner.suggest_cta')}
          </Text>
        </Pressable>
      ) : null}

      {suggestions !== null && suggestions.length === 0 ? (
        <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.textMuted }}>
          {t('mobile.planner.empty')}
        </Text>
      ) : null}

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.sm }}>
          {error}
        </Text>
      ) : null}

      {Array.isArray(suggestions) && suggestions.length > 0 ? (
        suggestions.map((s, idx) => (
          <View
            key={`${s.taskId}-${idx}`}
            style={{
              borderTopWidth: 1, borderTopColor: COLORS.border,
              paddingVertical: SPACING.sm, marginTop: SPACING.sm,
            }}
          >
            <Text
              numberOfLines={2}
              style={{ fontSize: FONT_SIZES.md, color: COLORS.text, fontWeight: '500' }}
            >
              {s.taskText ?? s.taskId}
            </Text>
            <Text style={{ fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: 2 }}>
              {_formatSlot(s.slotStart, s.slotEnd, t)}
            </Text>
            {s.reason ? (
              <View style={{
                alignSelf: 'flex-start', marginTop: SPACING.sm,
                paddingVertical: 2, paddingHorizontal: SPACING.sm,
                borderRadius: RADII.pill, backgroundColor: COLORS.surfaceMuted,
              }}>
                <Text style={{ fontSize: FONT_SIZES.xs, color: COLORS.textMuted }}>
                  {t(REASON_KEYS[s.reason] ?? '', s.reason)}
                </Text>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', marginTop: SPACING.sm }}>
              <Pressable
                onPress={() => onAccept(s)}
                accessibilityRole="button"
                accessibilityLabel={`planner-accept-${s.taskId}`}
                style={{
                  paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                  borderRadius: RADII.pill, backgroundColor: COLORS.primary,
                  marginRight: SPACING.sm,
                }}
              >
                <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '600' }}>
                  {t('mobile.planner.accept')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onSkip(s)}
                accessibilityRole="button"
                accessibilityLabel={`planner-skip-${s.taskId}`}
                style={{
                  paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
                  borderRadius: RADII.pill, borderWidth: 1, borderColor: COLORS.border,
                  backgroundColor: COLORS.surface,
                }}
              >
                <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
                  {t('mobile.planner.skip')}
                </Text>
              </Pressable>
            </View>
          </View>
        ))
      ) : null}
    </View>
  );
}

/**
 * Format a {start, end} epoch-ms slot pair as `DD/MM HH:MM–HH:MM`.
 * Exported separately for tests + callers that want the same label
 * shape elsewhere.
 */
export function _formatSlot(startMs, endMs, t) {
  if (typeof startMs !== 'number' || typeof endMs !== 'number') return '—';
  const start = new Date(startMs);
  const end   = new Date(endMs);
  const date  = `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')}`;
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return t('mobile.planner.slot_label', null)
    .replace('{date}',  date)
    .replace('{start}', hhmm(start))
    .replace('{end}',   hhmm(end));
}

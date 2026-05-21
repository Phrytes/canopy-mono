/**
 * MetricsScreen — diagnostics view backed by `getMetrics`.
 *
 * Phase 41.18.2 (2026-05-10).
 *
 * Read-only. Renders a flat key→value table from the skill's response.
 * Useful for support tickets ("paste a screenshot of this") — same
 * surface the desktop CLI exposes via `--metrics`.
 *
 * Pull-to-refresh re-runs the skill.
 */

import React, { useCallback } from 'react';
import {
  View, Text, ScrollView, RefreshControl, Pressable,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useSkillResult } from '../lib/useSkill.js';
import { useLocalisation }    from '../LocalisationProvider.js';
import { useService } from '../ServiceContext.js';

export function MetricsScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const result  = useSkillResult('getMetrics', {}, [svc?.activeCrewId]);
  const data    = result?.data ?? null;
  const loading = !!result?.loading;
  const error   = result?.error ?? null;

  const onRefresh = useCallback(() => {
    result.refresh().catch(() => {});
  }, [result]);

  const rows = _flattenForDisplay(data);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView
        contentContainerStyle={{ padding: SPACING.lg }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
      >
        <Text style={{
          fontSize: FONT_SIZES.lg, fontWeight: '600', color: COLORS.text,
          marginBottom: SPACING.md,
        }}>
          {t('mobile.metrics.title')}
        </Text>
        <Text style={{
          color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginBottom: SPACING.lg,
        }}>
          {t('mobile.metrics.hint')}
        </Text>

        {error ? (
          <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm }}>
            {String(error?.message ?? error)}
          </Text>
        ) : null}

        {!data && !loading && !error ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
            {t('mobile.metrics.empty')}
          </Text>
        ) : null}

        {rows.length > 0 ? (
          <View style={{
            borderRadius: RADII.md,
            backgroundColor: COLORS.surface,
            padding: SPACING.md,
          }}>
            {rows.map(({ key, value }, idx) => (
              <View
                key={key}
                style={{
                  flexDirection: 'row', justifyContent: 'space-between',
                  paddingVertical: SPACING.xs,
                  borderTopWidth: idx === 0 ? 0 : 1,
                  borderTopColor: COLORS.border,
                }}
              >
                <Text style={{
                  color: COLORS.textMuted, fontSize: FONT_SIZES.xs,
                  fontFamily: 'monospace', flex: 1, marginRight: SPACING.sm,
                }}>
                  {key}
                </Text>
                <Text style={{
                  color: COLORS.text, fontSize: FONT_SIZES.xs,
                  fontFamily: 'monospace',
                }}
                selectable
                >
                  {value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <Pressable
          onPress={() => nav.goBack()}
          accessibilityRole="button"
          accessibilityLabel="metrics-back"
          style={{
            marginTop: SPACING.xl, alignSelf: 'flex-start',
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
            borderRadius: RADII.sm, borderWidth: 1, borderColor: COLORS.border,
          }}
        >
          <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md }}>
            {t('mobile.common.back')}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/**
 * Flatten an arbitrary JSON object into [{key:'a.b.c', value:'…'}] rows.
 * Numbers + strings + booleans render directly; nested objects use
 * dotted paths; arrays render with `[N]` suffix on the key.
 *
 * Exported for tests.
 *
 * @param {object|null} obj
 * @param {string} prefix
 * @returns {Array<{key: string, value: string}>}
 */
export function _flattenForDisplay(obj, prefix = '') {
  if (obj == null) return [];
  if (typeof obj !== 'object') {
    return [{ key: prefix || '(value)', value: String(obj) }];
  }
  const rows = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        rows.push({ key: path, value: '[]' });
      } else if (v.every((it) => typeof it !== 'object' || it === null)) {
        rows.push({ key: path, value: `[${v.map(String).join(', ')}]` });
      } else {
        v.forEach((it, idx) => {
          rows.push(..._flattenForDisplay(it, `${path}[${idx}]`));
        });
      }
    } else if (v != null && typeof v === 'object') {
      rows.push(..._flattenForDisplay(v, path));
    } else {
      rows.push({ key: path, value: v == null ? '—' : String(v) });
    }
  }
  return rows;
}

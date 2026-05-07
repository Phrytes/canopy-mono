/**
 * SkillPicker — categorised chip multi-select for the user's skills.
 *
 * Stoop V3 Phase 40.15 (2026-05-08).
 *
 * Receives the taxonomy categories (loaded via
 * `useProfile().listSkillCategories(lang)`) + the user's currently-
 * selected skill array (each entry has at least `categoryId`).
 *
 * Pure-controlled component. Tapping a chip calls the right callback:
 *   - chip not yet selected → `onAdd({categoryId})`
 *   - chip already selected → `onRemove(categoryId)`
 *
 * Per-skill freeTags / availability / radius are out of scope for
 * V3.0 — those land as a sub-flow in a follow-up.
 */

import React from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { localiseField }                      from '../lib/skillPicker.js';

/**
 * @param {object} props
 * @param {Array<{id: string, label: {nl: string, en: string} | string, hint?: object}>} props.categories
 * @param {Array<{categoryId: string}>} props.selected
 * @param {string} [props.lang='nl']
 * @param {(entry: {categoryId: string}) => void} props.onAdd
 * @param {(categoryId: string) => void}          props.onRemove
 */
export function SkillPicker({
  categories = [], selected = [], lang = 'nl', onAdd, onRemove,
}) {
  const selectedSet = new Set((selected ?? []).map((s) => s.categoryId));

  return (
    <ScrollView
      horizontal={false}
      contentContainerStyle={styles.grid}
    >
      {categories.map((cat) => {
        const id     = cat.id;
        const label  = localiseField(cat.label, lang);
        const hint   = localiseField(cat.hint,  lang);
        const active = selectedSet.has(id);
        return (
          <Pressable
            key={id}
            onPress={() => {
              if (active) onRemove?.(id);
              else        onAdd?.({ categoryId: id });
            }}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`skill-chip-${id}`}
          >
            <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
              {label || id}
            </Text>
            {hint ? (
              <Text style={[styles.chipHint, active && styles.chipHintActive]} numberOfLines={2}>
                {hint}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// `localiseField` lives in `../lib/skillPicker.js` so vitest can
// import it without going through this JSX file.
export { localiseField as _localised } from '../lib/skillPicker.js';

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row', flexWrap: 'wrap',
    paddingVertical: SPACING.sm,
  },
  chip: {
    width: '48%',
    margin: '1%',
    padding: SPACING.md,
    borderRadius: RADII.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primary,
  },
  chipLabel: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
  },
  chipLabelActive: {
    color: COLORS.primaryDark,
  },
  chipHint: {
    marginTop: 2,
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
  chipHintActive: {
    color: COLORS.primaryDark,
  },
});

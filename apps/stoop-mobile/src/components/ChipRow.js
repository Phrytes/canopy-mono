/**
 * ChipRow — horizontal scrollable row of selectable chips.
 *
 * Used for filter chips on the Feed (skill taxonomy slices), the
 * post-compose's skill picker, profile skill list, etc.
 *
 * Pure-controlled component: pass `items`, `selected`, and `onToggle`.
 */

import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';

/**
 * @param {object} props
 * @param {Array<{id: string, label: string}>} props.items
 * @param {Set<string>|string[]} [props.selected]
 * @param {(id: string) => void} props.onToggle
 * @param {boolean} [props.singleSelect=false] — clicking a different chip
 *   deselects the previous one (radio-style).
 */
export function ChipRow({ items = [], selected, onToggle, singleSelect = false }) {
  const sel = _toSet(selected);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {items.map((it) => {
        const active = sel.has(it.id);
        return (
          <Pressable
            key={it.id}
            onPress={() => {
              if (typeof onToggle === 'function') onToggle(it.id, { singleSelect });
            }}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function _toSet(v) {
  if (v instanceof Set) return v;
  if (Array.isArray(v)) return new Set(v);
  return new Set();
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.md,
    paddingVertical:   SPACING.sm,
  },
  chip: {
    paddingVertical:   SPACING.sm - 2,
    paddingHorizontal: SPACING.md,
    borderRadius:      RADII.pill,
    borderWidth:       1,
    borderColor:       COLORS.border,
    backgroundColor:   COLORS.surface,
    marginRight:       SPACING.sm,
  },
  chipActive: {
    backgroundColor:   COLORS.primary,
    borderColor:       COLORS.primaryDark,
  },
  chipText: {
    color:    COLORS.text,
    fontSize: FONT_SIZES.sm,
  },
  chipTextActive: {
    color:      COLORS.textInverse,
    fontWeight: '600',
  },
});

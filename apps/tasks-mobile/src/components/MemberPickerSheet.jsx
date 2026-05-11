/**
 * MemberPickerSheet — modal-bottom-sheet member picker.
 *
 * Phase 41.18.1 (2026-05-10).
 *
 * Used by:
 *   - TaskDetail's reassign flow (single-select webid)
 *   - Compose's master selector (single-select webid)
 *   - Compose's dependencies selector (multi-select task ids — same
 *     shape; the component is generic over `items` + `selected`)
 *
 * Avoids pulling in @gorhom/bottom-sheet — Tasks-mobile's other modals
 * use the plain RN Modal, this matches.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, TextInput,
} from 'react-native';

import { useTheme } from '@canopy/react-native/theme';

/**
 * @param {object}   props
 * @param {boolean}  props.visible
 * @param {string}   props.title
 * @param {string}   [props.searchPlaceholder]
 * @param {Array<{id: string, label: string, sub?: string}>} props.items
 * @param {string|string[]|null} props.selected   — string for single-select,
 *                                                  array for multi-select
 * @param {boolean}  [props.multi]                — default false
 * @param {(next: string|string[]|null) => void} props.onSelect
 * @param {() => void} props.onCancel
 * @param {() => void} [props.onConfirm]          — only used when multi
 */
export function MemberPickerSheet({
  visible,
  title,
  searchPlaceholder,
  items = [],
  selected = null,
  multi = false,
  onSelect,
  onCancel,
  onConfirm,
}) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const [filter, setFilter] = useState('');

  const handleTap = useCallback((id) => {
    if (multi) {
      const cur = Array.isArray(selected) ? selected : [];
      if (cur.includes(id)) {
        onSelect(cur.filter((x) => x !== id));
      } else {
        onSelect([...cur, id]);
      }
    } else {
      onSelect(id);
    }
  }, [multi, selected, onSelect]);

  if (!visible) return null;

  const filtered = filter.trim()
    ? items.filter((it) => {
        const q = filter.trim().toLowerCase();
        return (it.label ?? '').toLowerCase().includes(q)
            || (it.sub   ?? '').toLowerCase().includes(q);
      })
    : items;

  const isSelected = (id) =>
    multi ? (Array.isArray(selected) && selected.includes(id))
          : (selected === id);

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onCancel}>
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1, justifyContent: 'flex-end',
          backgroundColor: COLORS.overlay,
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation?.()}
          style={{
            backgroundColor: COLORS.surface,
            borderTopLeftRadius: RADII.lg,
            borderTopRightRadius: RADII.lg,
            paddingTop: SPACING.lg,
            paddingHorizontal: SPACING.xl,
            paddingBottom: SPACING.xl,
            maxHeight: '70%',
          }}
        >
          <View style={{
            width: 36, height: 4, borderRadius: 2,
            backgroundColor: COLORS.border, alignSelf: 'center',
            marginBottom: SPACING.md,
          }} />

          <Text style={{
            fontSize: FONT_SIZES.lg, fontWeight: '600',
            color: COLORS.text, marginBottom: SPACING.md,
          }}>
            {title}
          </Text>

          {items.length > 6 ? (
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder={searchPlaceholder ?? 'Search…'}
              placeholderTextColor={COLORS.textMuted}
              accessibilityLabel="member-picker-filter"
              style={{
                borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
                padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
                backgroundColor: COLORS.surface, marginBottom: SPACING.md,
              }}
            />
          ) : null}

          <ScrollView style={{ maxHeight: 360 }}>
            {filtered.length === 0 ? (
              <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm, padding: SPACING.md }}>
                —
              </Text>
            ) : filtered.map((it) => {
              const sel = isSelected(it.id);
              return (
                <Pressable
                  key={it.id}
                  onPress={() => handleTap(it.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sel }}
                  accessibilityLabel={`member-picker-row-${it.id}`}
                  style={({ pressed }) => [
                    {
                      paddingVertical: SPACING.md,
                      paddingHorizontal: SPACING.md,
                      borderRadius: RADII.sm,
                      backgroundColor: sel ? COLORS.surfaceMuted : COLORS.surface,
                      marginBottom: SPACING.xs,
                      flexDirection: 'row', alignItems: 'center',
                    },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <View style={{
                    width: 18, height: 18, borderRadius: 9,
                    borderWidth: 2,
                    borderColor: sel ? COLORS.primary : COLORS.border,
                    backgroundColor: sel ? COLORS.primary : 'transparent',
                    marginRight: SPACING.md,
                  }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' }}>
                      {it.label}
                    </Text>
                    {it.sub ? (
                      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 }}>
                        {it.sub}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={{
            flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACING.lg,
          }}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="member-picker-cancel"
              style={{
                paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
                borderRadius: RADII.sm, marginLeft: SPACING.sm,
                backgroundColor: COLORS.surfaceMuted,
              }}
            >
              <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md }}>
                Cancel
              </Text>
            </Pressable>
            {multi && onConfirm ? (
              <Pressable
                onPress={onConfirm}
                accessibilityRole="button"
                accessibilityLabel="member-picker-done"
                style={{
                  paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
                  borderRadius: RADII.sm, marginLeft: SPACING.sm,
                  backgroundColor: COLORS.primary,
                }}
              >
                <Text style={{
                  color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600',
                }}>
                  Done
                </Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

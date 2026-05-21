/**
 * AudiencePicker — WhatsApp-style multi-select for post targets.
 *
 * Stoop V3 Phase 40.16 (2026-05-08).
 *
 * Two scrollable sections: groups (top) + contacts (bottom). Multi-
 * select; tap-to-toggle; the selected set lifts as `targets[]` in
 * the shape Stoop's `targetResolver` expects:
 *
 *   `{kind: 'group',   groupId}`
 *   `{kind: 'contact', webid: stableId|webid}`
 *
 * Pure controlled — caller manages `selected` + `onChange`.
 */

import React from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/localisation.js';
import { AvatarCircle }                       from './AvatarCircle.js';
import { isTargetSelected, toggleTarget }     from '../lib/audience.js';

/**
 * @param {object} props
 * @param {Array<{groupId: string, displayName?: string}>} [props.groups]
 * @param {Array<{webid?: string, stableId?: string, handle?: string, displayName?: string, avatarUrl?: string}>} [props.contacts]
 * @param {Array<object>} props.selected   each entry `{kind, groupId|webid}`
 * @param {(next: Array<object>) => void} props.onChange
 */
export function AudiencePicker({
  groups = [], contacts = [], selected = [], onChange,
}) {
  const togglePress = (target) => {
    if (typeof onChange !== 'function') return;
    onChange(toggleTarget(selected, target));
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      {groups.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('audience.groups', 'Groepen')}</Text>
          {groups.map((g) => {
            const target = { kind: 'group', groupId: g.groupId };
            const active = isTargetSelected(selected, target);
            return (
              <Pressable
                key={g.groupId}
                onPress={() => togglePress(target)}
                style={[styles.row, active && styles.rowActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`audience-group-${g.groupId}`}
              >
                <View style={styles.rowAvatar}>
                  <AvatarCircle name={g.displayName ?? g.groupId} size={36} />
                </View>
                <Text style={styles.rowLabel}>{g.displayName ?? g.groupId}</Text>
                <View style={[styles.checkbox, active && styles.checkboxActive]}>
                  {active ? <Text style={styles.checkmark}>✓</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {contacts.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('audience.contacts', 'Contacten')}</Text>
          {contacts.map((c) => {
            const id = c.stableId ?? c.webid ?? c.handle;
            const target = { kind: 'contact', webid: id };
            const active = isTargetSelected(selected, target);
            const name   = c.displayName ?? `@${c.handle ?? '?'}`;
            return (
              <Pressable
                key={id}
                onPress={() => togglePress(target)}
                style={[styles.row, active && styles.rowActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`audience-contact-${id}`}
              >
                <View style={styles.rowAvatar}>
                  <AvatarCircle name={name} uri={c.avatarUrl} size={36} />
                </View>
                <Text style={styles.rowLabel}>{name}</Text>
                <View style={[styles.checkbox, active && styles.checkboxActive]}>
                  {active ? <Text style={styles.checkmark}>✓</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {groups.length === 0 && contacts.length === 0 ? (
        <Text style={styles.empty}>
          {t('audience.empty', 'Geen groepen of contacten om naar te posten.')}
        </Text>
      ) : null}
    </ScrollView>
  );
}

export default AudiencePicker;

const styles = StyleSheet.create({
  root: { paddingVertical: SPACING.sm },
  section: { marginBottom: SPACING.md },
  sectionTitle: {
    fontSize: FONT_SIZES.sm, fontWeight: '600',
    color: COLORS.textMuted, paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
  },
  rowActive: { backgroundColor: COLORS.primaryLight },
  rowAvatar: { marginRight: SPACING.md },
  rowLabel:  { flex: 1, fontSize: FONT_SIZES.md, color: COLORS.text },
  checkbox: {
    width: 24, height: 24, borderRadius: RADII.sm,
    borderWidth: 2, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxActive: {
    borderColor: COLORS.primary, backgroundColor: COLORS.primary,
  },
  checkmark: { color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  empty: { padding: SPACING.xl, color: COLORS.textMuted, textAlign: 'center' },
});

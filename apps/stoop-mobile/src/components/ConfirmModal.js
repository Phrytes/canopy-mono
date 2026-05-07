/**
 * ConfirmModal — yes/no overlay used for destructive confirmations
 * (delete a post, leave a group, mute a user, ...).
 *
 * Stoop V3 — used by GroupScreen, ContactScreen, ProfileMine.
 *
 * Pure controlled.  Caller manages the open/closed state and
 * provides callbacks.  Renders nothing when `visible === false`.
 */

import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';

/**
 * @param {object} props
 * @param {boolean} props.visible
 * @param {string}  props.title
 * @param {string}  [props.body]
 * @param {string}  [props.confirmLabel='Bevestig']
 * @param {string}  [props.cancelLabel='Annuleer']
 * @param {boolean} [props.destructive=false]   confirm renders red
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 */
export function ConfirmModal({
  visible,
  title,
  body,
  confirmLabel = 'Bevestig',
  cancelLabel  = 'Annuleer',
  destructive  = false,
  onConfirm,
  onCancel,
}) {
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {body ? <Text style={styles.body}>{body}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.btn, styles.btnCancel, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.btnLabel}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.btn,
                destructive ? styles.btnDanger : styles.btnConfirm,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={[styles.btnLabel, styles.btnLabelInverse]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.overlay, padding: SPACING.lg,
  },
  card: {
    width: '100%', maxWidth: 400,
    backgroundColor: COLORS.surface,
    borderRadius: RADII.md, padding: SPACING.xl,
  },
  title: {
    fontSize: FONT_SIZES.lg,
    color:    COLORS.text,
    fontWeight: '600',
  },
  body: {
    marginTop: SPACING.md,
    fontSize:  FONT_SIZES.md,
    color:     COLORS.textMuted,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row', justifyContent: 'flex-end',
    marginTop: SPACING.lg,
  },
  btn: {
    paddingVertical:   SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius:      RADII.sm,
    marginLeft:        SPACING.sm,
  },
  btnCancel:  { backgroundColor: COLORS.surfaceMuted },
  btnConfirm: { backgroundColor: COLORS.primary },
  btnDanger:  { backgroundColor: COLORS.danger },
  btnLabel: {
    fontSize: FONT_SIZES.md,
    color:    COLORS.text,
    fontWeight: '500',
  },
  btnLabelInverse: { color: COLORS.textInverse },
  pressed: { opacity: 0.8 },
});

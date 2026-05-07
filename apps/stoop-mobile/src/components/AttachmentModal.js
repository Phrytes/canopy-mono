/**
 * AttachmentModal — full-screen photo viewer with horizontal swipe.
 *
 * Stoop V3 — opened from PostCard / ItemDetail / ChatThread when the
 * user taps an attachment.  Pure controlled.
 *
 * Implementation note: we render a plain horizontal `FlatList` of
 * full-bleed images.  Pinch-zoom is intentionally out of scope for
 * V3 (would pull `react-native-gesture-handler` + `reanimated`).
 */

import React from 'react';
import {
  Modal, View, Text, Image, FlatList, Pressable,
  Dimensions, StyleSheet,
} from 'react-native';

import { COLORS, SPACING, FONT_SIZES } from '../lib/theme.js';
import { attachmentUri } from '../lib/post.js';

const SCREEN = Dimensions.get('window');

/**
 * @param {object} props
 * @param {boolean} props.visible
 * @param {Array<object>} props.attachments  same shape as PostCard
 * @param {number} [props.initialIndex=0]
 * @param {() => void} props.onClose
 */
export function AttachmentModal({
  visible, attachments = [], initialIndex = 0, onClose,
}) {
  if (!visible) return null;
  const items = attachments.filter((a) => attachmentUri(a) != null);

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <FlatList
          data={items}
          horizontal
          pagingEnabled
          initialScrollIndex={Math.max(0, Math.min(initialIndex, items.length - 1))}
          getItemLayout={(_, idx) => ({ length: SCREEN.width, offset: SCREEN.width * idx, index: idx })}
          keyExtractor={(_, i) => String(i)}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => {
            const uri = attachmentUri(item);
            return (
              <View style={styles.page}>
                {uri ? (
                  <Image source={{ uri }} style={styles.image} resizeMode="contain" />
                ) : (
                  <Text style={styles.errorText}>Image not available.</Text>
                )}
              </View>
            );
          }}
        />
        <Pressable
          onPress={onClose}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
        >
          <Text style={styles.closeLabel}>×</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  page: {
    width:  SCREEN.width,
    height: SCREEN.height,
    alignItems:     'center',
    justifyContent: 'center',
  },
  image:     { width: SCREEN.width, height: SCREEN.height * 0.95 },
  closeBtn: {
    position: 'absolute',
    top:      SPACING.xl,
    right:    SPACING.xl,
    width: 40, height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeLabel: {
    color: COLORS.textInverse,
    fontSize: FONT_SIZES.xxl,
    lineHeight: FONT_SIZES.xxl,
  },
  errorText: {
    color:    COLORS.textInverse,
    fontSize: FONT_SIZES.md,
  },
});

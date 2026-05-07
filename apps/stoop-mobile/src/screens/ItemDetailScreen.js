/**
 * ItemDetailScreen — full detail of a single Stoop post.
 *
 * Stoop V3 mobile.  Renders author header + body + attachments grid;
 * tapping a thumb opens the AttachmentModal.  CTAs:
 *   - "Reageer" → opens / creates a 1:1 chat thread with the author.
 *   - "Help aanbieden" / "Claim" — wired by bring-up code.
 *   - "Verberg" / "Meld" overflow.
 *
 * Pure UI: receives the resolved item + author from props or
 * `route.params`.  Bring-up code in 40.10-H wires the SDK calls.
 */

import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, Image, StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/i18n.js';
import { AvatarCircle }                      from '../components/AvatarCircle.js';
import { AttachmentModal }                   from '../components/AttachmentModal.js';
import { attachmentUri, timeAgo }            from '../lib/post.js';

/**
 * @param {object} props
 * @param {object} [props.item]       overrides `route.params.item` if given
 * @param {object} [props.author]
 * @param {() => Promise<void>} [props.onClaim]
 * @param {() => Promise<void>} [props.onHide]
 * @param {() => Promise<void>} [props.onReport]
 */
export function ItemDetailScreen({
  item: itemProp, author, onClaim, onHide, onReport,
} = {}) {
  const nav   = useNavigation();
  const route = useRoute();
  const item  = itemProp ?? route?.params?.item;

  const [modalIdx, setModalIdx]   = useState(-1);

  if (!item) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('item_detail.unknown_item', 'Post niet gevonden.')}
        </Text>
      </View>
    );
  }

  const time = timeAgo(item.createdAt);
  const atts = Array.isArray(item.attachments) ? item.attachments : [];

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <View style={styles.header}>
        <AvatarCircle
          uri={author?.avatarUri}
          name={author?.handle ?? '·'}
          size={48}
        />
        <View style={styles.headerText}>
          <Text style={styles.handle}>{author?.handle ?? 'anon'}</Text>
          <Text style={styles.meta}>
            {(item.kind ?? 'vraag')}{time ? ` • ${time}` : ''}
          </Text>
        </View>
      </View>

      {item.text ? <Text style={styles.body}>{item.text}</Text> : null}

      {atts.length > 0 ? (
        <View style={styles.thumbs}>
          {atts.map((att, i) => {
            const uri = attachmentUri(att);
            if (!uri) return null;
            return (
              <Pressable
                key={i}
                onPress={() => setModalIdx(i)}
                style={styles.thumbWrap}
                accessibilityRole="button"
                accessibilityLabel={`item-detail-attachment-${i}`}
              >
                <Image source={{ uri }} style={styles.thumb} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {Array.isArray(item.skills) && item.skills.length > 0 ? (
        <View style={styles.skills}>
          {item.skills.map((s) => (
            <View key={s} style={styles.skillPill}>
              <Text style={styles.skillText}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={() => nav.navigate(ROUTES.ChatThread, { itemId: item.id, peerId: item.authorId })}
          style={styles.btnPrimary}
          accessibilityRole="button"
          accessibilityLabel="item-detail-chat"
        >
          <Text style={styles.btnPrimaryLabel}>
            {t('item_detail.chat', 'Reageer met chat')}
          </Text>
        </Pressable>
        {onClaim ? (
          <Pressable
            onPress={onClaim}
            style={styles.btnSecondary}
            accessibilityRole="button"
            accessibilityLabel="item-detail-claim"
          >
            <Text style={styles.btnSecondaryLabel}>
              {t('item_detail.claim', 'Help aanbieden')}
            </Text>
          </Pressable>
        ) : null}
        {onHide ? (
          <Pressable onPress={onHide} style={styles.btnGhost}>
            <Text style={styles.btnGhostLabel}>{t('item_detail.hide', 'Verberg')}</Text>
          </Pressable>
        ) : null}
        {onReport ? (
          <Pressable onPress={onReport} style={styles.btnGhost}>
            <Text style={styles.btnGhostLabel}>{t('item_detail.report', 'Meld')}</Text>
          </Pressable>
        ) : null}
      </View>

      <AttachmentModal
        visible={modalIdx >= 0}
        attachments={atts}
        initialIndex={modalIdx}
        onClose={() => setModalIdx(-1)}
      />
    </ScrollView>
  );
}

export default ItemDetailScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md },
  headerText: { marginLeft: SPACING.md, flex: 1 },
  handle: { fontSize: FONT_SIZES.lg, fontWeight: '600', color: COLORS.text },
  meta:   { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: 2 },
  body:   { fontSize: FONT_SIZES.md, color: COLORS.text, lineHeight: 22, marginBottom: SPACING.md },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACING.sm },
  thumbWrap: { width: 96, height: 96, marginRight: SPACING.sm, marginBottom: SPACING.sm },
  thumb:  {
    width: '100%', height: '100%', borderRadius: RADII.sm,
    backgroundColor: COLORS.surfaceMuted,
  },
  skills: { flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACING.sm },
  skillPill: {
    paddingVertical: 4, paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.primaryLight, borderRadius: RADII.pill,
    marginRight: SPACING.sm, marginTop: SPACING.xs,
  },
  skillText: { color: COLORS.primaryDark, fontSize: FONT_SIZES.xs, fontWeight: '500' },
  actions: { marginTop: SPACING.lg },
  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg, borderRadius: RADII.md,
    alignItems: 'center', marginBottom: SPACING.sm,
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted,
    paddingVertical: SPACING.lg, borderRadius: RADII.md,
    alignItems: 'center', marginBottom: SPACING.sm,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  btnGhost: { paddingVertical: SPACING.sm, alignItems: 'center' },
  btnGhostLabel: { color: COLORS.danger, fontSize: FONT_SIZES.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted },
});

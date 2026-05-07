/**
 * PostCard — Prikbord row card.  Renders one Stoop post (vraag /
 * aanbod) with up to N attachment thumbnails, the author's avatar,
 * the body text, and a small skill-chip strip.
 *
 * Stoop V3 — used by FeedScreen and MineScreen.
 */

import React from 'react';
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { AvatarCircle } from './AvatarCircle.js';
import { attachmentUri, timeAgo } from '../lib/post.js';

/**
 * @param {object} props
 * @param {object} props.item — Stoop item shape from item-store
 *   (`{id, text, kind, skills, attachments, createdAt, ...}`)
 * @param {object} [props.author] — `{handle, avatarUri}`
 * @param {(item: object) => void} [props.onPress]
 * @param {(item: object, idx: number) => void} [props.onPressAttachment]
 *
 *   Attachments shape (from Phase 39 picture work):
 *     `{thumbnail: {dataB64, mime}, dataB64, mime, width, height}`
 *   Or just a URI: `{uri}`.
 */
export function PostCard({ item, author, onPress, onPressAttachment }) {
  if (!item) return null;
  const text  = item.text  ?? '';
  const kind  = item.kind  ?? 'vraag';
  const time  = timeAgo(item.createdAt);

  return (
    <Pressable
      onPress={() => { if (onPress) onPress(item); }}
      style={styles.card}
      accessibilityRole="button"
      accessibilityLabel={`${kind}: ${text}`}
    >
      <View style={styles.header}>
        <AvatarCircle
          uri={author?.avatarUri}
          name={author?.handle ?? '·'}
          size={36}
        />
        <View style={styles.headerText}>
          <Text style={styles.handle}>{author?.handle ?? 'anon'}</Text>
          <Text style={styles.meta}>
            {kind}{time ? ` • ${time}` : ''}
          </Text>
        </View>
      </View>

      {text.length > 0 && (
        <Text style={styles.body} numberOfLines={4}>{text}</Text>
      )}

      {Array.isArray(item.attachments) && item.attachments.length > 0 && (
        <View style={styles.thumbs}>
          {item.attachments.slice(0, 4).map((att, i) => {
            const uri = attachmentUri(att);
            if (!uri) return null;
            return (
              <Pressable
                key={i}
                onPress={() => { if (onPressAttachment) onPressAttachment(item, i); }}
                style={styles.thumbWrap}
              >
                <Image source={{ uri }} style={styles.thumb} />
              </Pressable>
            );
          })}
        </View>
      )}

      {Array.isArray(item.skills) && item.skills.length > 0 && (
        <View style={styles.skills}>
          {item.skills.slice(0, 4).map((s) => (
            <View key={s} style={styles.skillPill}>
              <Text style={styles.skillText} numberOfLines={1}>{s}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius:    RADII.md,
    padding:         SPACING.lg,
    marginHorizontal: SPACING.md,
    marginVertical:   SPACING.sm,
    borderWidth:     1,
    borderColor:     COLORS.border,
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  headerText: { marginLeft: SPACING.md, flex: 1 },
  handle: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text },
  meta:   { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: 2 },
  body: {
    marginTop: SPACING.sm,
    fontSize:  FONT_SIZES.md,
    color:     COLORS.text,
    lineHeight: 22,
  },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACING.sm },
  thumbWrap: {
    width: 80, height: 80, marginRight: SPACING.sm, marginTop: SPACING.sm,
  },
  thumb: {
    width: '100%', height: '100%', borderRadius: RADII.sm,
    backgroundColor: COLORS.surfaceMuted,
  },
  skills: {
    flexDirection: 'row', flexWrap: 'wrap',
    marginTop: SPACING.sm,
  },
  skillPill: {
    paddingVertical:   2,
    paddingHorizontal: SPACING.sm,
    backgroundColor:   COLORS.primaryLight,
    borderRadius:      RADII.pill,
    marginRight:       SPACING.sm,
    marginTop:         SPACING.xs,
  },
  skillText: { fontSize: FONT_SIZES.xs, color: COLORS.primaryDark, fontWeight: '500' },
});

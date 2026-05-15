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
  // Mirrored items only carry `type` (not `kind`) — fall back so
  // posts coming back via the substrate mirror still tag.
  const kind  = item.kind ?? item.type ?? 'request';
  const time  = timeAgo(item.createdAt);
  const badge = _kindBadge(kind);

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
            {time ?? ''}
          </Text>
        </View>
        <View style={[styles.kindBadge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.kindBadgeLabel, { color: badge.fg }]}>
            {badge.label}
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

function _kindBadge(kind) {
  switch (kind) {
    case 'vraag': case 'ask':
      return { label: 'Vraag',  bg: '#FFE6CC', fg: '#A04A00' };
    case 'aanbod': case 'offer':
      return { label: 'Aanbod', bg: '#D6F0DC', fg: '#1E6B2B' };
    case 'lend':
      return { label: 'Lenen',  bg: '#E0E5FF', fg: '#2E3F90' };
    case 'report':
      return { label: 'Melding', bg: '#FFE0E0', fg: '#90262E' };
    default:
      return { label: kind ?? '—', bg: COLORS.surfaceMuted, fg: COLORS.textMuted };
  }
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
    // Subtle elevation so cards "lift" — matches modern card UI.
    shadowColor:   COLORS.shadow ?? '#000',
    shadowOpacity: 0.05,
    shadowRadius:  4,
    shadowOffset:  { width: 0, height: 1 },
    elevation:     1,
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  headerText: { marginLeft: SPACING.md, flex: 1 },
  kindBadge: {
    paddingVertical:   2,
    paddingHorizontal: SPACING.sm,
    borderRadius:      RADII.pill,
    marginLeft:        SPACING.sm,
  },
  kindBadgeLabel: {
    fontSize:   FONT_SIZES.xs,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
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

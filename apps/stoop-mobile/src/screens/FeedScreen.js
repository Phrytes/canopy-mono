/**
 * FeedScreen — Prikbord (the feed of vraag / aanbod posts).
 *
 * Stoop V3 mobile.  Vertical FlatList of PostCard rows, with a
 * sticky filter ChipRow above and a primary FAB to compose a new
 * post.  Pull-to-refresh re-syncs items from the agent.
 *
 * Pure UI: items + filters live in props supplied by bring-up code
 * (Phase 40.10-H wires them to the live agent).
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, RefreshControl, Pressable, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/i18n.js';
import { filterFeed }                        from '../lib/feedFilter.js';
import { ChipRow }                           from '../components/ChipRow.js';
import { PostCard }                          from '../components/PostCard.js';

const KIND_FILTERS = [
  { id: 'vraag',  label: 'Vragen' },
  { id: 'aanbod', label: 'Aanbod' },
];

/**
 * @param {object} props
 * @param {Array<object>} [props.items]
 * @param {Map<string,object>|object} [props.authorIndex]
 *   `{ [authorId]: {handle, avatarUri} }`
 * @param {(item: object) => void} [props.onOpenItem]
 * @param {() => Promise<void>} [props.onRefresh]
 * @param {boolean} [props.refreshing]
 * @param {{cell: string}} [props.viewerLocation]
 */
export function FeedScreen({
  items = [],
  authorIndex,
  onOpenItem,
  onRefresh,
  refreshing = false,
  viewerLocation,
} = {}) {
  const nav = useNavigation();
  const [activeKinds, setActiveKinds] = useState(new Set());

  const filtered = filterFeed(items, {
    kinds: activeKinds,
    viewerCell: viewerLocation?.cell ?? null,
  });

  const toggleKind = useCallback((id) => {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleOpen = useCallback((item) => {
    if (onOpenItem) onOpenItem(item);
    nav.navigate(ROUTES.ItemDetail, { itemId: item?.id });
  }, [onOpenItem, nav]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('feed.heading', 'Prikbord')}</Text>
        <ChipRow
          items={KIND_FILTERS}
          selected={activeKinds}
          onToggle={toggleKind}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(it) => String(it?.id ?? Math.random())}
        renderItem={({ item }) => (
          <PostCard
            item={item}
            author={_lookupAuthor(authorIndex, item.authorId)}
            onPress={handleOpen}
          />
        )}
        refreshControl={onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        ) : undefined}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {items.length === 0
                ? t('feed.empty_no_items', 'Nog geen posts in deze buurt.')
                : t('feed.empty_filtered', 'Geen posts voor deze filter.')}
            </Text>
          </View>
        )}
      />

      <Pressable
        onPress={() => nav.navigate(ROUTES.PostCompose)}
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel="feed-compose-fab"
      >
        <Text style={styles.fabLabel}>{'+'}</Text>
      </Pressable>
    </View>
  );
}

function _lookupAuthor(idx, authorId) {
  if (!idx || !authorId) return null;
  if (idx instanceof Map) return idx.get(authorId) ?? null;
  if (typeof idx === 'object') return idx[authorId] ?? null;
  return null;
}

export default FeedScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingTop: SPACING.lg, paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: FONT_SIZES.xl, fontWeight: '700', color: COLORS.text,
    paddingHorizontal: SPACING.sm, marginBottom: SPACING.sm,
  },
  listContent: { paddingVertical: SPACING.sm },
  empty:     { padding: SPACING.xxl, alignItems: 'center' },
  emptyText: { fontSize: FONT_SIZES.md, color: COLORS.textMuted, textAlign: 'center' },
  fab: {
    position: 'absolute', right: SPACING.lg, bottom: SPACING.lg,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.shadow, shadowRadius: 6, shadowOpacity: 1,
    shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  fabLabel: {
    color: COLORS.textInverse, fontSize: FONT_SIZES.xxl,
    lineHeight: FONT_SIZES.xxl, fontWeight: '600',
  },
});

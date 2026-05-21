/**
 * FeedScreen — Prikbord (the feed of vraag / aanbod posts).
 *
 * Stoop V3 mobile.  Phase 40.16 (2026-05-08): wired to the live agent
 * via `useSkillResult('listOpen', ...)` + an `agent.on('item-arrive', ...)`
 * subscription so the list refreshes when new items land.
 *
 * Filter chips drive the server-side `listOpen({kind})` filter; the
 * client-side `filterFeed` still post-filters by skills + distance
 * for things the server doesn't yet support.
 */

import React, { useCallback, useState, useEffect } from 'react';
import {
  View, Text, FlatList, RefreshControl, Pressable, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/localisation.js';
import { filterFeed }                        from '../lib/feedFilter.js';
import { ChipRow }                           from '../components/ChipRow.js';
import { PostCard }                          from '../components/PostCard.js';
import { useService }                        from '../ServiceContext.js';
import { useSkillResult }                    from '../lib/useSkillResult.js';
import { useAgentEvent }                     from '../lib/useAgentEvent.js';

function _kindFilters() {
  return [
    { id: 'vraag',  label: t('feed.kind_vraag',  'Asks') },
    { id: 'aanbod', label: t('feed.kind_aanbod', 'Offers') },
  ];
}

export function FeedScreen() {
  const nav = useNavigation();
  const svc = useService();

  const [activeKinds, setActiveKinds] = useState(new Set());
  const kindFilter = activeKinds.size === 1 ? [...activeKinds][0] : null;

  // Server-side filter via listOpen — re-runs when the kind chip
  // changes. Client-side filterFeed handles distance / skill filters
  // (server doesn't yet take them).
  const { data, loading, refresh } = useSkillResult(
    'listOpen', kindFilter ? { kind: kindFilter } : {}, [kindFilter],
  );

  // When a new item arrives via skill-match broadcast, re-run listOpen.
  const arrivedItem = useAgentEvent('item-arrive');
  useEffect(() => {
    if (arrivedItem != null) refresh().catch(() => { /* swallow */ });
  }, [arrivedItem, refresh]);

  const items     = Array.isArray(data?.items) ? data.items : [];
  // Client-side filter for the case where the user has multiple
  // kinds active (server only takes one).
  const filtered  = filterFeed(items, {
    kinds: activeKinds.size > 1 ? activeKinds : null,
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
    nav.navigate(ROUTES.ItemDetail, { itemId: item?.id, item });
  }, [nav]);

  // ── Empty state — no agent yet (no group joined). ────────────────
  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('feed.no_group',
             'Sluit eerst aan bij een groep om het prikbord te zien.')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('feed.heading', 'Prikbord')}</Text>
        {svc?.activeEntry?.displayName ? (
          <Text style={styles.groupLabel} numberOfLines={1}>
            {svc.activeEntry.displayName}
          </Text>
        ) : null}
        <ChipRow
          items={_kindFilters()}
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
            author={_lookupAuthor(item)}
            onPress={handleOpen}
          />
        )}
        refreshControl={(
          <RefreshControl refreshing={loading} onRefresh={refresh} />
        )}
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

/**
 * `listOpen` already hydrates each item's author into a `{handle,
 * displayName?, isRevealed, render}` block (per Stoop's
 * `hydrateItems`). The PostCard takes `{handle, avatarUri}` — just
 * unpack the right slot.
 */
function _lookupAuthor(item) {
  const a = item?.authorRender ?? item?.author;
  if (!a) return null;
  return {
    handle:    a.handle ?? null,
    avatarUri: a.avatarUrl ?? a.avatarUri ?? null,
  };
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
    paddingHorizontal: SPACING.sm, marginBottom: SPACING.xs,
  },
  groupLabel: {
    fontSize: FONT_SIZES.sm, color: COLORS.textMuted,
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

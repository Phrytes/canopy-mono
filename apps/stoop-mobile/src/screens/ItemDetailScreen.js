/**
 * ItemDetailScreen — full detail of a single Stoop post.
 *
 * Stoop V3 mobile.  Phase 40.16 (2026-05-08): wired to the live
 * agent.  When `route.params.item` is set (passed from Feed), uses
 * it inline; otherwise looks up the item via `bundle.itemStore.getById`
 * (no `getItem` skill exists today — direct cache read is fine since
 * the agent is in-process).
 *
 * Actions: respond ("Ik help"), hide, report (open as a follow-up).
 * Author of the post sees: cancel-request + accept-/reject-claim
 * inline (Mine-style controls).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, Image, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/i18n.js';
import { AvatarCircle }                      from '../components/AvatarCircle.js';
import { AttachmentModal }                   from '../components/AttachmentModal.js';
import { attachmentUri, timeAgo }            from '../lib/post.js';
import { useService }                        from '../ServiceContext.js';
import { useSkill }                          from '../lib/useSkill.js';

export function ItemDetailScreen() {
  const nav   = useNavigation();
  const route = useRoute();
  const svc   = useService();

  const handFedItem = route?.params?.item ?? null;
  const itemId      = route?.params?.itemId ?? handFedItem?.id ?? null;

  const [item, setItem]         = useState(handFedItem);
  const [loading, setLoading]   = useState(!handFedItem);
  const [error, setError]       = useState(null);
  const [modalIdx, setModalIdx] = useState(-1);

  const respondCall    = useSkill('respondToItem');
  const cancelCall     = useSkill('cancelRequest');
  const acceptCall     = useSkill('acceptResponder');
  const markReturned   = useSkill('markReturned');

  // Direct read from itemStore when we don't have an inline item.
  const refresh = useCallback(async () => {
    if (handFedItem) { setItem(handFedItem); return; }
    if (!itemId)     return;
    const store = svc?.activeBundle?.itemStore;
    if (!store?.getById) return;
    setLoading(true);
    try {
      const fresh = await store.getById(itemId);
      setItem(fresh);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [handFedItem, itemId, svc]);

  useEffect(() => { refresh().catch(() => { /* swallow */ }); }, [refresh]);

  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('item_detail.no_active_group',
             'Sluit eerst aan bij een groep om posts te bekijken.')}
        </Text>
      </View>
    );
  }
  if (loading) {
    return <View style={styles.empty}><ActivityIndicator /></View>;
  }
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
  const author = item.authorRender ?? item.author ?? {};
  const selfAddr = svc.activeBundle.agent.address ?? svc.activeBundle.agent.identity?.pubKey;
  const isMine = item.from === selfAddr || item.authorWebid === selfAddr;
  const claims = Array.isArray(item.claims) ? item.claims : [];

  const respond = async () => {
    try {
      await respondCall.call({ itemId: item.id });
      await refresh();
    } catch (err) { setError(err); }
  };
  const cancel = async () => {
    try {
      await cancelCall.call({ requestId: item.id });
      await refresh();
    } catch (err) { setError(err); }
  };
  const acceptResponder = async (claim) => {
    try {
      await acceptCall.call({ requestId: item.id, responder: claim.responderWebid ?? claim.from });
      await refresh();
    } catch (err) { setError(err); }
  };
  const markDone = async () => {
    try {
      await markReturned.call({ requestId: item.id });
      await refresh();
    } catch (err) { setError(err); }
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <View style={styles.header}>
        <AvatarCircle uri={author.avatarUrl ?? author.avatarUri} name={author.handle ?? '·'} size={48} />
        <View style={styles.headerText}>
          <Text style={styles.handle}>@{author.handle ?? 'anon'}</Text>
          <Text style={styles.meta}>{(item.kind ?? item.type ?? 'vraag')}{time ? ` • ${time}` : ''}</Text>
        </View>
      </View>

      {item.text ? <Text style={styles.body}>{item.text}</Text> : null}

      {atts.length > 0 ? (
        <View style={styles.thumbs}>
          {atts.map((att, i) => {
            const uri = attachmentUri(att);
            if (!uri) return null;
            return (
              <Pressable key={i} onPress={() => setModalIdx(i)} style={styles.thumbWrap}>
                <Image source={{ uri }} style={styles.thumb} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {Array.isArray(item.requiredSkills) && item.requiredSkills.length > 0 ? (
        <View style={styles.skills}>
          {item.requiredSkills.map((s) => (
            <View key={s} style={styles.skillPill}>
              <Text style={styles.skillText}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        {!isMine ? (
          <Pressable
            onPress={respond}
            disabled={respondCall.loading}
            style={styles.btnPrimary}
            accessibilityRole="button"
            accessibilityLabel="item-detail-respond"
          >
            <Text style={styles.btnPrimaryLabel}>
              {respondCall.loading
                ? t('item_detail.responding', 'Bezig…')
                : t('item_detail.respond', 'Ik help')}
            </Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              onPress={cancel}
              style={styles.btnDanger}
              accessibilityRole="button"
              accessibilityLabel="item-detail-cancel"
            >
              <Text style={styles.btnDangerLabel}>
                {t('item_detail.cancel', 'Annuleer post')}
              </Text>
            </Pressable>
            {(item.kind === 'lend' || item.type === 'lend') && !item.completedAt ? (
              <Pressable
                onPress={markDone}
                style={styles.btnSecondary}
                accessibilityRole="button"
              >
                <Text style={styles.btnSecondaryLabel}>
                  {t('item_detail.mark_returned', 'Markeer als teruggebracht')}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
        <Pressable
          onPress={() => nav.navigate(ROUTES.ChatThread, { itemId: item.id, peerId: item.from ?? item.authorWebid })}
          style={styles.btnSecondary}
        >
          <Text style={styles.btnSecondaryLabel}>
            {t('item_detail.chat', 'Reageer met chat')}
          </Text>
        </Pressable>
      </View>

      {/* Claim list — author-side. */}
      {isMine && claims.length > 0 ? (
        <View style={styles.claimsBlock}>
          <Text style={styles.claimsHeading}>{t('mine.claims_heading', 'Reacties')}</Text>
          {claims.map((c) => {
            const status = c.status ?? 'open';
            return (
              <View key={c.id ?? c.responderWebid} style={styles.claimRow}>
                <Text style={styles.claimLabel}>
                  @{c.responderHandle ?? c.responderRender?.handle ?? '?'} · {status}
                </Text>
                {(status === 'open' || status == null) ? (
                  <Pressable
                    onPress={() => acceptResponder(c)}
                    style={styles.btnAccept}
                    accessibilityRole="button"
                  >
                    <Text style={styles.btnAcceptLabel}>
                      {t('mine.accept_claim', 'Accepteer')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{String(error?.message ?? error)}</Text> : null}

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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted, textAlign: 'center' },
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
  btnDanger: {
    backgroundColor: COLORS.danger,
    paddingVertical: SPACING.lg, borderRadius: RADII.md,
    alignItems: 'center', marginBottom: SPACING.sm,
  },
  btnDangerLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  claimsBlock: {
    marginTop: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  claimsHeading: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm },
  claimRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  claimLabel: { flex: 1, fontSize: FONT_SIZES.sm, color: COLORS.text },
  btnAccept: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md,
    borderRadius: RADII.sm,
  },
  btnAcceptLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },
});

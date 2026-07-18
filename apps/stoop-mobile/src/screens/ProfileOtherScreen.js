/**
 * ProfileOtherScreen — read-only view of another member's profile.
 *
 * Stoop V3 mobile.  Equivalent of the modal `/`-page detail on the
 * web. Looks up the member from the active bundle's MemberMap via
 * `useMemberProfile`. The route opens with `{pubKey}` or
 * `{stableId}` or `{webid}` in `route.params`.
 *
 * Reveal handshake + add-contact + mute land in Phases 40.17 / 40.18;
 * here we expose them as navigation hand-offs (open chat → reveal in
 * thread; open contact-detail in 40.18).
 */

import React from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/localisation.js';
import { AvatarCircle }                       from '../components/AvatarCircle.js';
import { useMemberProfile }                   from '../lib/useMemberProfile.js';
import { useService }                         from '../ServiceContext.js';

export function ProfileOtherScreen() {
  const nav   = useNavigation();
  const route = useRoute();
  const svc   = useService();

  // Route can pass any combination of pubKey / stableId / webid /
  // a hand-rolled `member` object (legacy from Phase 40.10).
  const params      = route?.params ?? {};
  const handFedMember = params.member;
  const lookupArgs  = {
    pubKey:   params.pubKey,
    stableId: params.stableId,
    webid:    params.webid,
  };

  const { member: liveMember, loading, error } = useMemberProfile(lookupArgs);
  const m = handFedMember ?? liveMember;

  // Reveal-state for the viewer side.  The active bundle's `reveals`
  // store carries the local "I have revealed to this peer" flag —
  // and inbound reveal-confirmations from the peer flip a bit on
  // their MemberMap entry. Both pieces are read-only here.
  const reveals = svc?.activeBundle?.reveals;
  const revealedFromMe = m && reveals?.hasRevealed?.(m.stableId ?? m.webid ?? m.pubKey);
  const revealed = !!(m?.revealed || revealedFromMe);
  const name = (revealed && m?.displayName) ? m.displayName : `@${m?.handle ?? '?'}`;

  if (loading) {
    return <View style={styles.empty}><ActivityIndicator /></View>;
  }
  if (!m) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {error?.code === 'UNKNOWN_MEMBER'
            ? t('profile_other.unknown_member', 'Onbekend lid.')
            : t('profile_other.no_active_group',
                'Sluit eerst aan bij een groep om profielen te bekijken.')}
        </Text>
      </View>
    );
  }

  const peerKey = m.stableId ?? m.pubKey ?? m.webid ?? null;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <View style={styles.hero}>
        <AvatarCircle uri={m.avatarUrl ?? m.avatarUri} name={name} size={96} />
        <Text style={styles.handle}>@{m.handle}</Text>
        {revealed && m.displayName ? (
          <Text style={styles.displayName}>{m.displayName}</Text>
        ) : null}
      </View>

      {(() => {
        // Read-accept: prefer the new `offerings` field, fall back to legacy `skills`.
        const offerings = Array.isArray(m.offerings) ? m.offerings
          : (Array.isArray(m.skills) ? m.skills : []);
        return offerings.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('profile_other.skills', 'Skills')}</Text>
          <View style={styles.chips}>
            {offerings.map((s) => (
              <View key={s.categoryId ?? s} style={styles.chip}>
                <Text style={styles.chipText}>{s.categoryId ?? s}</Text>
              </View>
            ))}
          </View>
        </View>
        ) : null;
      })()}

      {m.holidayMode ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('profile_other.holiday', 'Vakantie')}</Text>
          <Text style={styles.body}>
            {t('profile_other.holiday_body', 'Dit lid is op vakantie.')}
          </Text>
        </View>
      ) : null}

      {m.location?.label ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('profile_other.location', 'Locatie')}</Text>
          <Text style={styles.body}>{m.location.label}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={() => nav.navigate(ROUTES.ChatThread, { peerId: peerKey })}
          style={styles.btnPrimary}
          accessibilityRole="button"
          accessibilityLabel="profile-other-open-chat"
        >
          <Text style={styles.btnPrimaryLabel}>
            {t('profile_other.open_chat', 'Stuur bericht')}
          </Text>
        </Pressable>

        {!revealed ? (
          <Pressable
            onPress={() => nav.navigate(ROUTES.ChatThread, { peerId: peerKey, intent: 'reveal' })}
            style={styles.btnSecondary}
            accessibilityRole="button"
          >
            <Text style={styles.btnSecondaryLabel}>
              {t('profile_other.request_reveal', 'Vraag echte naam')}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => nav.navigate(ROUTES.Contact, { memberId: peerKey })}
          style={styles.btnSecondary}
          accessibilityRole="button"
        >
          <Text style={styles.btnSecondaryLabel}>
            {t('profile_other.contact_detail', 'Contact-instellingen')}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

export default ProfileOtherScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  hero: { alignItems: 'center', marginVertical: SPACING.xl },
  handle:      { marginTop: SPACING.md, fontSize: FONT_SIZES.lg, color: COLORS.text, fontWeight: '600' },
  displayName: { marginTop: SPACING.xs, fontSize: FONT_SIZES.md, color: COLORS.textMuted },
  section: {
    marginBottom: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  label: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm },
  body:  { fontSize: FONT_SIZES.sm, color: COLORS.textMuted, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingVertical: 4, paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.primaryLight, borderRadius: RADII.pill,
    marginRight: SPACING.sm, marginTop: SPACING.xs,
  },
  chipText: { color: COLORS.primaryDark, fontSize: FONT_SIZES.xs, fontWeight: '500' },
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted, textAlign: 'center' },
});

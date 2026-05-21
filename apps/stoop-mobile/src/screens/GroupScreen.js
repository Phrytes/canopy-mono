/**
 * GroupScreen — group / governance view.
 *
 * Stoop V3 mobile.  Phase 40.18 (2026-05-08): wired to live agent.
 * Reads:
 *   - getCurrentMembershipCode(groupId)  — admin code visibility
 *   - rotateMyGroupCode(groupId)         — admin only
 *   - leaveGroup({groupId})              — destructive
 *   - issueInvite({...})                 — admin generates QR
 */

import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/localisation.js';
import { ConfirmModal }                      from '../components/ConfirmModal.js';
import { useService }                        from '../ServiceContext.js';
import { useSkill }                          from '../lib/useSkill.js';
import { useSkillResult }                    from '../lib/useSkillResult.js';

export function GroupScreen() {
  const nav = useNavigation();
  const svc = useService();

  const activeEntry = svc?.activeEntry ?? null;
  const groupId = activeEntry?.groupId ?? null;

  const code = useSkillResult('getCurrentMembershipCode',
    groupId ? { groupId } : null, [groupId]);
  const open = useSkillResult('listOpen', {}, [groupId, svc?.lastEvent]);
  const rotate = useSkill('rotateMyGroupCode');
  const leave  = useSkill('leaveGroup');

  const [showLeave, setShowLeave] = useState(false);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);

  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('group.no_active_group',
             'Sluit eerst aan bij een groep om de groep-info te zien.')}
        </Text>
      </View>
    );
  }

  // Membership snapshot from MemberMap.
  const members = svc.activeBundle.members;
  const memberList = members?.list?.() ?? [];
  const selfAddr   = svc.activeBundle.agent.address ?? svc.activeBundle.agent.identity?.pubKey;
  const me = (typeof members?.resolveByPubKey === 'function')
    ? members.resolveByPubKey(selfAddr)
    : null;
  // Source of truth for "am I admin": the persisted groupRegistry
  // entry.  MemberMap can be empty after a cold start (in-memory
  // cache, no persistPath on mobile) — fall back to it only when the
  // registry doesn't have a role.
  const registryRole = activeEntry?.role ?? null;
  const memberRole   = me?.role ?? null;
  const role         = registryRole ?? memberRole;
  const isAdmin      = role === 'admin' || role === 'coordinator';
  const evicted      = !!activeEntry?.evicted;

  const onIssueInvite = async () => {
    setBusy(true); setError(null);
    try {
      // Stoop's invite is the current membership code wrapped as
      // `{groupId, code, expiresAt}`.  Read fresh data directly from
      // `refresh()` / `call()` returns instead of `code.data` — the
      // hook's state-setter writes don't land synchronously, so the
      // closure-captured `code.data` would be stale.
      let codeData = await code.refresh();
      if (!codeData?.code || codeData?.error) {
        // `getCurrentMembershipCode` returns {error: 'admin-only'}
        // for non-admins, OR {error: 'no-code'} when no active code
        // exists for this group.  Mint one and retry.
        const r = await rotate.call({ groupId });
        if (r?.error) throw new Error(`rotateMyGroupCode: ${r.error}`);
        codeData = await code.refresh();
      }
      if (!codeData?.code || codeData?.error) {
        const why = codeData?.error ?? 'no-code';
        setError(t('group.no_code',
                   'Geen actieve code gevonden. Probeer "Roteer code nu" om een nieuwe te maken.')
                 + ` (${why})`);
        return;
      }
      nav.navigate(ROUTES.OnboardIssue, {
        invite: {
          groupId,
          name:      activeEntry?.displayName ?? groupId,
          code:      codeData.code,
          expiresAt: codeData.expiresAt,
        },
      });
    } catch (err) { setError(err?.message ?? String(err)); }
    finally { setBusy(false); }
  };

  const onRotate = async () => {
    setBusy(true); setError(null);
    try {
      await rotate.call({ groupId });
      await code.refresh();
    } catch (err) { setError(err?.message ?? String(err)); }
    finally { setBusy(false); }
  };

  const onLeave = async () => {
    setShowLeave(false);
    setBusy(true); setError(null);
    try {
      await leave.call({ groupId });
      await svc.removeGroup(groupId);
      nav.navigate(ROUTES.Welcome);
    } catch (err) { setError(err?.message ?? String(err)); }
    finally { setBusy(false); }
  };

  const codeData    = code.data ?? {};
  const expiresAt   = codeData.expiresAt;
  const rotationDays= codeData.rotationDays;

  // Live peer connectivity — drives the diagnostic line under the
  // member count so the user can see whether mDNS / relay actually
  // found the other phone before scratching their head about why
  // posts haven't replicated.
  const skillMatchPeers = (() => {
    try { return svc.activeBundle.skillMatch?.listPeers?.() ?? []; }
    catch { return []; }
  })();
  const mirrorPeers = (() => {
    try { return svc.activeBundle.mirror?.listPeers?.() ?? []; }
    catch { return []; }
  })();
  const transportNames = (() => {
    try {
      const v = svc.activeBundle.agent?.transportNames;
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  })();
  const selfPk = (() => {
    try {
      return svc.activeBundle.agent?.address
        ?? svc.activeBundle.agent?.identity?.pubKey
        ?? '';
    } catch { return ''; }
  })();
  const _shortPk = (pk) => (typeof pk === 'string' && pk.length > 8) ? pk.slice(0, 8) + '…' : (pk ?? '?');

  const [reprobeReport, setReprobeReport] = useState(null);
  const reprobe = async () => {
    // Two cheap nudges to break out of asymmetric mDNS hello state:
    //   1. agent.startDiscovery's gossip — pings each known peer
    //      with our peer-list so they backfill ours into theirs.
    //   2. explicit hello to every PeerGraph entry. mDNS may have
    //      surfaced an addr but the auto-hello never landed; this
    //      re-tries the handshake.
    //
    // **Retry loop**: right after app-launch the PeerGraph is empty
    // because mDNS service-discovery hasn't fired yet (Android NSD
    // can take 10-30s).  Wait + retry instead of bailing out
    // immediately — most "0 peers said hello" reports are just
    // tapping too soon.
    setBusy(true); setError(null); setReprobeReport(null);
    try {
      const a = svc.activeBundle.agent;
      const deadlineMs = 15_000;
      const start = Date.now();
      let peerEntries = [];
      while (Date.now() - start < deadlineMs) {
        try { a?.discovery?.gossip?.(); } catch { /* swallow */ }
        peerEntries = (await a?.peers?.all?.().catch(() => [])) ?? [];
        peerEntries = peerEntries.filter(p => p?.pubKey && p.pubKey !== a.address);
        if (peerEntries.length > 0) break;
        // Tell the user we're waiting so the screen doesn't look frozen.
        setReprobeReport(t('group.reprobe_waiting',
                           'Wachten op mDNS-ontdekking… ({s}s)')
                         .replace('{s}', String(Math.round((Date.now() - start) / 1000))));
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (peerEntries.length === 0) {
        setReprobeReport(t('group.reprobe_no_peers',
                           'Geen peers ontdekt na 15s. mDNS bereikt het andere toestel niet — probeer de relay (Settings → Relay-server).'));
        return;
      }
      let hellos = 0;
      for (const p of peerEntries) {
        try { await a.hello?.(p.pubKey); hellos += 1; } catch { /* swallow */ }
      }
      setReprobeReport(t('group.reprobe_done',
                         '{n} peers gegroet')
                       .replace('{n}', String(hellos)));
    } catch (err) { setError(err?.message ?? String(err)); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>
        {activeEntry?.displayName ?? groupId ?? t('group.unnamed', 'Onbekende groep')}
      </Text>

      {evicted ? (
        <View style={styles.evictionBanner}>
          <Text style={styles.evictionTitle}>
            {t('group.evicted_title', 'Je bent uit deze groep verwijderd.')}
          </Text>
          <Text style={styles.evictionBody}>
            {t('group.evicted_body',
               'Je kan posts en berichten in deze groep niet meer zien. Vraag de admin opnieuw uitgenodigd te worden.')}
          </Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.label}>{t('group.member_count', 'Aantal leden')}</Text>
        <Text style={styles.value}>{memberList.length}</Text>
      </View>

      {/* Diagnostic: peer connectivity + local-store volume.
          Lets you separate three failure modes:
            1. transports = "default" only → mDNS/relay never wired.
            2. transports include mdns/relay but match=0/mirror=0 →
               discovery isn't reaching the other phone.
            3. mirror>0 but items=0 → discovery worked, replication
               didn't (broadcasts not delivered or filtered out). */}
      <View style={styles.section}>
        <Text style={styles.label}>
          {t('group.peers_label', 'Verbindingen')}
        </Text>
        <Text style={[styles.value, styles.mono]} selectable>
          {t('group.self_pk', 'Ik: {pk}')
            .replace('{pk}', _shortPk(selfPk))}
        </Text>
        <Text style={styles.value}>
          {t('group.peers_value',
             '{sm} match · {mr} mirror · transports: {tx}')
            .replace('{sm}', String(skillMatchPeers.length))
            .replace('{mr}', String(mirrorPeers.length))
            .replace('{tx}', transportNames.length > 0 ? transportNames.join(', ') : '—')}
        </Text>
        {skillMatchPeers.length > 0 ? (
          <Text style={[styles.hint, styles.mono]} selectable>
            {t('group.match_peers', 'match: {pks}')
              .replace('{pks}', skillMatchPeers.map(_shortPk).join(', '))}
          </Text>
        ) : null}
        {mirrorPeers.length > 0 ? (
          <Text style={[styles.hint, styles.mono]} selectable>
            {t('group.mirror_peers', 'mirror: {pks}')
              .replace('{pks}', mirrorPeers.map(_shortPk).join(', '))}
          </Text>
        ) : null}
        <Text style={[styles.value, { marginTop: SPACING.xs }]}>
          {t('group.items_value',
             '{n} posts in deze groep')
            .replace('{n}', String(Array.isArray(open.data?.items) ? open.data.items.length : 0))}
        </Text>
        <Text style={styles.hint}>
          {t('group.peers_hint',
             'Match: peers waarvan we matchmaking-broadcasts ontvangen. Mirror: peers waarvan we posts in het prikbord mirrorren. 0 = ontdek-laag bereikt het andere toestel niet (zelfde Wi-Fi? dev client opnieuw gebouwd na permissie-fix? relay-URL ingesteld?).')}
        </Text>
        <Pressable
          onPress={reprobe}
          disabled={busy}
          style={[styles.btnPrimary, busy && styles.btnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="group-reprobe-peers"
        >
          <Text style={styles.btnPrimaryLabel}>
            {busy
              ? t('group.reprobe_busy', 'Bezig…')
              : t('group.reprobe', 'Verbinding opnieuw proberen')}
          </Text>
        </Pressable>
        {reprobeReport ? (
          <Text style={styles.successText}>{reprobeReport}</Text>
        ) : null}
      </View>

      {isAdmin && codeData.code ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('group.admin_code', 'Admin-code')}</Text>
          <Text style={[styles.value, styles.mono]} selectable>{codeData.code}</Text>
          <Text style={styles.hint}>
            {t('group.admin_code_hint',
               'Deel deze code alleen met andere admins.')}
          </Text>
          {expiresAt ? (
            <Text style={styles.hint}>
              {t('group.admin_code_expires', 'Verloopt op {ts} ({n} dagen)')
                .replace('{ts}', new Date(expiresAt).toLocaleDateString())
                .replace('{n}', String(rotationDays ?? 30))}
            </Text>
          ) : null}
          <Pressable
            onPress={onRotate}
            disabled={busy}
            style={styles.btnSecondary}
            accessibilityRole="button"
            accessibilityLabel="group-rotate-code"
          >
            <Text style={styles.btnSecondaryLabel}>
              {busy ? t('group.rotating', 'Roteren…')
                    : t('group.rotate_code', 'Roteer code nu')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {isAdmin ? (
        <Pressable
          onPress={onIssueInvite}
          disabled={busy}
          style={styles.btnPrimary}
          accessibilityRole="button"
          accessibilityLabel="group-issue-invite"
        >
          <Text style={styles.btnPrimaryLabel}>
            {busy
              ? t('group.issuing', 'Maken…')
              : t('group.issue_invite', 'Maak uitnodiging')}
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        onPress={() => setShowLeave(true)}
        style={styles.btnDanger}
        accessibilityRole="button"
        accessibilityLabel="group-leave"
      >
        <Text style={styles.btnDangerLabel}>
          {t('group.leave', 'Verlaat groep')}
        </Text>
      </Pressable>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {code.loading ? <ActivityIndicator /> : null}

      <ConfirmModal
        visible={showLeave}
        destructive
        title={t('group.confirm_leave_title', 'Verlaat deze groep?')}
        body={t('group.confirm_leave_body',
                'Je verliest de toegang tot alle posts en berichten in deze groep.')}
        confirmLabel={t('group.confirm_leave_yes', 'Verlaat')}
        cancelLabel={t('contact.confirm_no', 'Annuleer')}
        onConfirm={onLeave}
        onCancel={() => setShowLeave(false)}
      />
    </ScrollView>
  );
}

export default GroupScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZES.md, textAlign: 'center' },
  evictionBanner: {
    backgroundColor: '#ffebee', borderColor: COLORS.danger, borderWidth: 1,
    borderRadius: RADII.md, padding: SPACING.lg, marginBottom: SPACING.lg,
  },
  evictionTitle: { color: COLORS.danger, fontSize: FONT_SIZES.md, fontWeight: '600', marginBottom: SPACING.xs },
  evictionBody:  { color: COLORS.text, fontSize: FONT_SIZES.sm, lineHeight: 20 },
  section: {
    marginBottom: SPACING.md, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  label: { fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.xs },
  value: { fontSize: FONT_SIZES.md, color: COLORS.text, fontWeight: '500' },
  mono:  { fontFamily: 'monospace', fontSize: FONT_SIZES.sm },
  hint:  { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: SPACING.xs },
  btnPrimary: {
    backgroundColor: COLORS.primary, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center', marginTop: SPACING.md,
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnDisabled:     { opacity: 0.5 },
  successText:     { color: COLORS.success, fontSize: FONT_SIZES.sm, fontWeight: '600', marginTop: SPACING.sm },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted, paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg, borderRadius: RADII.sm,
    alignItems: 'center', marginTop: SPACING.md,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  btnDanger: {
    backgroundColor: COLORS.danger, paddingVertical: SPACING.lg,
    borderRadius: RADII.md, alignItems: 'center', marginTop: SPACING.lg,
  },
  btnDangerLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },
});

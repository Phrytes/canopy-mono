/**
 * SettingsScreen — two-section split per V3 functional design § 4g.
 *
 * Stoop V3 Phase 40.19 (2026-05-08): wired to live agent via
 * `useSettings`. Sections:
 *
 *   Shared (cross-device):
 *     - broadcastable
 *     - defaultShareLocation
 *
 *   This device:
 *     - pollIntervalMs
 *     - onlineWindow.everyMinutes
 *     - onlineWindow.durationSec
 *     - allowHopThrough
 *
 * Profile lives elsewhere (ProfileMineScreen). Edits go through
 * updateSettings with the right `scope` so the value lands in the
 * right pod blob (devices/<deviceId>.json or shared.json).
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/localisation.js';
import {
  coercePollInterval, MOBILE_DEFAULTS,
  POLL_INTERVAL_MIN_MS, POLL_INTERVAL_MAX_MS,
} from '../lib/settings.js';
import { useService }                        from '../ServiceContext.js';
import { useSettings }                       from '../lib/useSettings.js';
import { useSkill }                          from '../lib/useSkill.js';
import { getRelayUrl, setRelayUrl }          from '../lib/relayUrl.js';
import { ConfirmModal }                      from '../components/ConfirmModal.js';

export function SettingsScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { settings, loading, error: hookError, update } = useSettings();

  const [pollInput,  setPollInput]  = useState('');
  const [everyInput, setEveryInput] = useState('');
  const [durInput,   setDurInput]   = useState('');
  const [relayInput, setRelayInput] = useState('');
  const [relaySaved, setRelaySaved] = useState(false);
  const [busyKey,    setBusyKey]    = useState(null);
  const [error,      setError]      = useState(null);
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [rotateResult,      setRotateResult]      = useState(null);
  const rotateAddress = useSkill('rotateMyAddress');

  // Hydrate the relay-URL input from AsyncStorage on mount.
  useEffect(() => {
    let cancelled = false;
    getRelayUrl().then((url) => {
      if (!cancelled && typeof url === 'string') setRelayInput(url);
    });
    return () => { cancelled = true; };
  }, []);

  // Hydrate inputs when settings load.
  useEffect(() => {
    if (!settings) return;
    setPollInput(String(settings.pollIntervalMs ?? MOBILE_DEFAULTS.pollIntervalMs));
    setEveryInput(settings.onlineWindow?.everyMinutes != null
      ? String(settings.onlineWindow.everyMinutes) : '');
    setDurInput(settings.onlineWindow?.durationSec != null
      ? String(settings.onlineWindow.durationSec) : '');
  }, [settings]);

  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('settings.no_active_group',
             'Sluit eerst aan bij een groep om instellingen te beheren.')}
        </Text>
      </View>
    );
  }

  const savePoll = async () => {
    setError(null); setBusyKey('poll');
    try {
      const next = coercePollInterval(pollInput);
      await update({ pollIntervalMs: next }, 'device');
      setPollInput(String(next));
    } catch (err) { setError(err?.message ?? String(err)); }
    finally { setBusyKey(null); }
  };

  const saveOnlineWindow = async () => {
    setError(null); setBusyKey('window');
    try {
      const everyMinutes = everyInput.trim() === '' ? null : Number.parseInt(everyInput, 10);
      const durationSec  = durInput.trim()   === '' ? null : Number.parseInt(durInput,   10);
      if (everyMinutes != null && (!Number.isFinite(everyMinutes) || everyMinutes < 1)) {
        throw new Error(t('settings.error_every',  'Frequentie moet ≥ 1 minuut zijn.'));
      }
      if (durationSec != null && (!Number.isFinite(durationSec) || durationSec < 5)) {
        throw new Error(t('settings.error_duration', 'Duur moet ≥ 5 seconden zijn.'));
      }
      await update({ onlineWindow: { everyMinutes, durationSec } }, 'device');
    } catch (err) { setError(err?.message ?? String(err)); }
    finally { setBusyKey(null); }
  };

  const toggleHop = async () => {
    setError(null); setBusyKey('hop');
    try {
      await update({ allowHopThrough: !settings?.allowHopThrough }, 'device');
    } catch (err) { setError(err?.message ?? String(err)); }
    finally { setBusyKey(null); }
  };

  const toggleBroadcastable = async () => {
    setError(null); setBusyKey('broadcastable');
    try {
      await update({ broadcastable: !settings?.broadcastable }, 'shared');
    } catch (err) { setError(err?.message ?? String(err)); }
    finally { setBusyKey(null); }
  };

  const toggleDefaultShareLocation = async () => {
    setError(null); setBusyKey('defaultShareLocation');
    try {
      await update({ defaultShareLocation: !settings?.defaultShareLocation }, 'shared');
    } catch (err) { setError(err?.message ?? String(err)); }
    finally { setBusyKey(null); }
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>{t('settings.heading', 'Instellingen')}</Text>
      {loading ? <ActivityIndicator style={{ marginVertical: SPACING.md }} /> : null}
      {hookError ? <Text style={styles.errorText}>{hookError.message}</Text> : null}

      {/* ── Shared (cross-device) ─────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t('settings.shared_heading', 'Gedeeld (alle toestellen)')}
        </Text>

        <ToggleRow
          label={t('settings.broadcastable',
                   'Anderen mogen me aanbod-suggesties sturen')}
          hint={t('settings.broadcastable_hint',
                  'Aan = je krijgt voorgestelde matches uit de bredere connectielijst (groepen + contacten + hops). Uit = stilte.')}
          on={!!settings?.broadcastable}
          busy={busyKey === 'broadcastable'}
          onToggle={toggleBroadcastable}
        />

        <ToggleRow
          label={t('settings.default_share_location',
                   'Locatie standaard delen met nieuwe contacten')}
          hint={t('settings.default_share_location_hint',
                  'Per-contact altijd handmatig aan/uit te zetten.')}
          on={!!settings?.defaultShareLocation}
          busy={busyKey === 'defaultShareLocation'}
          onToggle={toggleDefaultShareLocation}
        />

        <Pressable
          onPress={() => nav.navigate(ROUTES.ProfileMine)}
          style={styles.btnSecondary}
        >
          <Text style={styles.btnSecondaryLabel}>
            {t('settings.edit_profile', 'Bewerk profiel')}
          </Text>
        </Pressable>
      </View>

      {/* ── Group ─────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t('settings.group_heading', 'Groep')}
        </Text>
        <Text style={styles.hint}>
          {t('settings.group_link_hint',
             'Bekijk leden, maak een uitnodiging-QR, verlaat de groep.')}
        </Text>

        {/* List EVERY joined group so multi-group users can switch
            focus.  The active one is marked + tapping a non-active
            row both switches activeGroup AND nav's to GroupScreen. */}
        {[...(svc.groups?.values?.() ?? [])].map(({ entry }) => {
          const isActive = entry.groupId === svc.activeGroupId;
          return (
            <Pressable
              key={entry.groupId}
              onPress={async () => {
                if (!isActive) {
                  try { await svc.switchActiveGroup?.(entry.groupId); }
                  catch (err) { setError(err?.message ?? String(err)); return; }
                }
                nav.navigate(ROUTES.Group);
              }}
              style={styles.btnSecondary}
              accessibilityRole="button"
              accessibilityLabel={`settings-manage-group-${entry.groupId}`}
            >
              <Text style={styles.btnSecondaryLabel}>
                {entry.displayName ?? entry.groupId}
                {isActive
                  ? ' '
                    + t('settings.group_active_marker', '· actief')
                  : ''}
              </Text>
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => nav.navigate(ROUTES.OnboardScan)}
          style={styles.btnSecondary}
          accessibilityRole="button"
          accessibilityLabel="settings-scan-invite"
        >
          <Text style={styles.btnSecondaryLabel}>
            {t('settings.scan_invite_link', 'Sluit aan via QR')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => nav.navigate(ROUTES.CreateGroup)}
          style={styles.btnSecondary}
          accessibilityRole="button"
          accessibilityLabel="settings-create-another-group"
        >
          <Text style={styles.btnSecondaryLabel}>
            {t('settings.create_another_group', 'Maak een nieuwe groep')}
          </Text>
        </Pressable>
      </View>

      {/* ── This device ──────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t('settings.device_heading', 'Dit toestel')}
        </Text>

        <Text style={styles.label}>{t('settings.poll_interval', 'Pollinterval (ms)')}</Text>
        <TextInput
          value={pollInput}
          onChangeText={setPollInput}
          keyboardType="numeric"
          style={styles.input}
          accessibilityLabel="settings-poll-input"
        />
        <Text style={styles.hint}>
          {t('settings.poll_hint',
             'Tussen {min}-{max} ms. Mobiel-default: {def} ms (batterijbewust).')
            .replace('{min}', String(POLL_INTERVAL_MIN_MS))
            .replace('{max}', String(POLL_INTERVAL_MAX_MS))
            .replace('{def}', String(MOBILE_DEFAULTS.pollIntervalMs))}
        </Text>
        <Pressable
          onPress={savePoll}
          disabled={busyKey === 'poll'}
          style={styles.btnPrimary}
          accessibilityRole="button"
          accessibilityLabel="settings-save-poll"
        >
          <Text style={styles.btnPrimaryLabel}>
            {busyKey === 'poll'
              ? t('settings.saving', 'Opslaan…')
              : t('settings.save',   'Opslaan')}
          </Text>
        </Pressable>

        <Text style={[styles.label, { marginTop: SPACING.lg }]}>
          {t('settings.online_window_heading', 'Online-venster (achtergrond)')}
        </Text>
        <Text style={styles.hint}>
          {t('settings.online_window_hint',
             'Hoe vaak en hoe lang verbindt je telefoon op de achtergrond? Leeg = altijd via push.')}
        </Text>
        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: SPACING.sm }}>
            <Text style={styles.subLabel}>{t('settings.every_minutes', 'elke X min')}</Text>
            <TextInput
              value={everyInput}
              onChangeText={setEveryInput}
              keyboardType="numeric"
              style={styles.input}
              placeholder=""
              accessibilityLabel="settings-every-input"
            />
          </View>
          <View style={{ flex: 1, marginLeft: SPACING.sm }}>
            <Text style={styles.subLabel}>{t('settings.duration_sec', 'duur (sec)')}</Text>
            <TextInput
              value={durInput}
              onChangeText={setDurInput}
              keyboardType="numeric"
              style={styles.input}
              placeholder=""
              accessibilityLabel="settings-duration-input"
            />
          </View>
        </View>
        <Pressable
          onPress={saveOnlineWindow}
          disabled={busyKey === 'window'}
          style={styles.btnPrimary}
        >
          <Text style={styles.btnPrimaryLabel}>
            {busyKey === 'window'
              ? t('settings.saving', 'Opslaan…')
              : t('settings.save',   'Opslaan')}
          </Text>
        </Pressable>

        <ToggleRow
          label={t('settings.hop_label', 'Sta hop-relay door mijn toestel toe')}
          hint={t('settings.hop_hint',
                  'Mag mijn toestel berichten voor anderen doorgeven? Default uit (zuinig met batterij).')}
          on={!!settings?.allowHopThrough}
          busy={busyKey === 'hop'}
          onToggle={toggleHop}
        />

        {/* ── Relay URL (Path B for cross-device discovery) ────── */}
        <Text style={[styles.label, { marginTop: SPACING.md }]}>
          {t('settings.relay_url_label', 'Relay-server (optioneel)')}
        </Text>
        <Text style={styles.hint}>
          {t('settings.relay_url_hint',
             'Voor toestellen die elkaar niet over het lokale Wi-Fi-netwerk vinden. Vul ws://<host>:8787 in. Wijzigingen treden pas op na herstart van de app.')}
        </Text>
        <TextInput
          value={relayInput}
          onChangeText={(s) => { setRelayInput(s); setRelaySaved(false); }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="ws://192.168.1.10:8787"
          style={styles.input}
          accessibilityLabel="settings-relay-url-input"
        />
        <Pressable
          onPress={async () => {
            setError(null);
            try {
              await setRelayUrl(relayInput.trim().length === 0 ? null : relayInput.trim());
              setRelaySaved(true);
            } catch (err) {
              setError(err?.message ?? String(err));
            }
          }}
          style={styles.btnPrimary}
          accessibilityRole="button"
          accessibilityLabel="settings-save-relay"
        >
          <Text style={styles.btnPrimaryLabel}>
            {t('settings.relay_url_save', 'Relay-URL opslaan')}
          </Text>
        </Pressable>
        {relaySaved ? (
          <Text style={styles.successText}>
            {t('settings.relay_url_saved',
               'Opgeslagen. Herstart de app om te activeren.')}
          </Text>
        ) : null}
      </View>

      {/* ── Privacy & meldingen links ─────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t('settings.privacy_heading', 'Privacy & meldingen')}
        </Text>
        <Pressable onPress={() => nav.navigate(ROUTES.Push)} style={styles.btnSecondary}>
          <Text style={styles.btnSecondaryLabel}>{t('settings.push_link', 'Meldingen')}</Text>
        </Pressable>
        <Pressable onPress={() => nav.navigate(ROUTES.Privacy)} style={styles.btnSecondary}>
          <Text style={styles.btnSecondaryLabel}>{t('settings.privacy_link', 'Privacy & veiligheid')}</Text>
        </Pressable>
        <Pressable onPress={() => nav.navigate(ROUTES.SignIn)} style={styles.btnSecondary}>
          <Text style={styles.btnSecondaryLabel}>
            {t('settings.signin_link', 'Solid pod-aanmelding')}
          </Text>
        </Pressable>
        <Pressable onPress={() => nav.navigate(ROUTES.OfferingMatchInbox)} style={styles.btnSecondary}>
          <Text style={styles.btnSecondaryLabel}>
            {t('settings.skillmatch_link', 'Voorgestelde matches')}
          </Text>
        </Pressable>

        {/* Phase 40.22: rotate identity address */}
        <Text style={[styles.label, { marginTop: SPACING.md }]}>
          {t('settings.rotate_identity_label', 'Netwerk-adres rotatie')}
        </Text>
        <Text style={styles.hint}>
          {t('settings.rotate_identity_hint',
             'Vervangt je publieke sleutel met een verse. Je stableId blijft gelijk — contacten en mute-lijsten volgen je. 7 dagen genade-periode voor in-flight berichten.')}
        </Text>
        <Pressable
          onPress={() => setShowRotateConfirm(true)}
          disabled={busyKey === 'rotate'}
          style={styles.btnSecondary}
          accessibilityRole="button"
          accessibilityLabel="settings-rotate-identity"
        >
          <Text style={styles.btnSecondaryLabel}>
            {busyKey === 'rotate'
              ? t('settings.rotating_identity', 'Roteren…')
              : t('settings.rotate_identity', 'Roteer mijn adres nu')}
          </Text>
        </Pressable>
        {rotateResult ? (
          <Text style={styles.successText}>
            {t('settings.rotate_done', 'Geroteerd. Nieuw adres: {pk}')
              .replace('{pk}', String(rotateResult.newPubKey ?? '').slice(0, 12) + '…')}
          </Text>
        ) : null}
      </View>

      <ConfirmModal
        visible={showRotateConfirm}
        title={t('settings.confirm_rotate_title', 'Roteer netwerk-adres?')}
        body={t('settings.confirm_rotate_body',
                'Je publieke sleutel wordt vervangen. Berichten van peers die de rotatie nog niet kennen worden 7 dagen lang met je oude sleutel ontsleuteld (genade-periode). Dit is een privacy-maatregel — niet ongedaan te maken.')}
        confirmLabel={t('settings.confirm_rotate_yes', 'Roteer')}
        cancelLabel={t('contact.confirm_no', 'Annuleer')}
        onConfirm={async () => {
          setShowRotateConfirm(false);
          setError(null); setBusyKey('rotate');
          try {
            const r = await rotateAddress.call({});
            if (r?.error) throw new Error(r.error);
            setRotateResult(r);
          } catch (err) { setError(err?.message ?? String(err)); }
          finally { setBusyKey(null); }
        }}
        onCancel={() => setShowRotateConfirm(false)}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

function ToggleRow({ label, hint, on, busy, onToggle }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, marginRight: SPACING.md }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Pressable
        onPress={() => { if (!busy) onToggle(); }}
        style={[styles.toggle, on && styles.toggleActive]}
        accessibilityRole="switch"
        accessibilityState={{ checked: on, busy }}
      >
        <Text style={styles.toggleSwitchLabel}>
          {busy ? '…' : on ? t('profile.holiday_on', 'Aan') : t('profile.holiday_off', 'Uit')}
        </Text>
      </Pressable>
    </View>
  );
}

export default SettingsScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', fontSize: FONT_SIZES.md },
  section: {
    marginBottom: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: FONT_SIZES.md, fontWeight: '600',
    color: COLORS.text, marginBottom: SPACING.md,
  },
  label:    { fontSize: FONT_SIZES.sm, fontWeight: '500', color: COLORS.text, marginBottom: SPACING.xs },
  subLabel: { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginBottom: SPACING.xs },
  row:      { flexDirection: 'row' },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
  },
  hint: { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: SPACING.xs },
  btnPrimary: {
    backgroundColor: COLORS.primary, paddingVertical: SPACING.md,
    borderRadius: RADII.sm, alignItems: 'center', marginTop: SPACING.md,
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted, paddingVertical: SPACING.md,
    borderRadius: RADII.sm, alignItems: 'center', marginTop: SPACING.sm,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SPACING.sm, marginTop: SPACING.sm,
  },
  toggleLabel: { fontSize: FONT_SIZES.md, color: COLORS.text, fontWeight: '500' },
  toggle: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADII.pill, backgroundColor: COLORS.surfaceMuted,
  },
  toggleActive: { backgroundColor: COLORS.primary },
  toggleSwitchLabel: { color: COLORS.text, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },
  successText: { color: COLORS.success, fontSize: FONT_SIZES.sm, fontWeight: '600', marginTop: SPACING.sm },
});

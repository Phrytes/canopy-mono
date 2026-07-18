/**
 * ProfileMineScreen — the user's own profile (Stoop V3 mobile).
 *
 * Mirrors `/profile.html` on the desktop:
 *   - Avatar (camera/library picker).
 *   - Handle (lowercase, 3-32 chars).
 *   - Real / chosen name (optional).
 *   - Skills (categorised chip multi-select via SkillPicker).
 *   - Holiday toggle.
 *   - Location (GPS-fetched cell, clearable).
 *   - Recovery phrase export (View / Copy).
 *
 * Wires every action to the live agent via `useProfile`. Renders a
 * "first onboard a group" placeholder when there's no active bundle
 * yet (Stoop's agent is per-group; before the user joins or creates
 * a group, none of the profile skills can run).
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/localisation.js';
import { validateHandle, normaliseHandle, HANDLE_LIMITS }
                                              from '../lib/handle.js';
import { formatLocationLine }                 from '../lib/profileSync.js';
import { pickAvatarImage }                    from '../lib/imagePicker.js';
import { getCoarseLocationFromGps }           from '../lib/geo.js';
import { useService }                         from '../ServiceContext.js';
import { useProfile }                         from '../lib/useProfile.js';
import { useSkill }                           from '../lib/useSkill.js';
import { AvatarCircle }                       from '../components/AvatarCircle.js';
import { ConfirmModal }                       from '../components/ConfirmModal.js';
import { SkillPicker }                        from '../components/SkillPicker.js';

export function ProfileMineScreen() {
  useNavigation(); // reserved for future header-button work

  const svc = useService();
  const {
    profile, loading, error: hookError,
    setHandle, setDisplayName,
    setAvatar, clearAvatar,
    setLocation, clearLocation,
    setHolidayMode,
    addSkill, removeSkill,
    listSkillCategories,
    getMnemonicOnce,
  } = useProfile();

  // Local UI state — input drafts, busy flags, modal toggles.
  const [handleInput, setHandleInput]       = useState('');
  const [displayInput, setDisplayInput]     = useState('');
  const [busyKey, setBusyKey]               = useState(null);
  const [savedKey, setSavedKey]             = useState(null);
  const [error, setError]                   = useState(null);
  const [categories, setCategories]         = useState([]);
  const [showRecovery, setShowRecovery]     = useState(false);

  // C5 — "My Solid pods" section state.
  const [podStatus, setPodStatus]           = useState(null);
  const [podStatusLoading, setPodStatusLoading] = useState(true);
  const [signOutBusy, setSignOutBusy]       = useState(false);
  const [signOutMsg, setSignOutMsg]         = useState(null);
  // Depend on the stable `.call` (a useCallback keyed on [skillId,
  // svc]; svc is memoized in ServiceContext) — NOT the whole skill
  // object, which `useSkill` rebuilds every render.  Depending on the
  // object made `refreshPodStatus` → its auto-running effect re-run on
  // every render and re-invoke the skill unboundedly (the profile-page
  // `podSignInStatus` flood, 2026-05-16).
  const podSignInStatusCall = useSkill('podSignInStatus').call;
  const signOutOfPodCall    = useSkill('signOutOfPod').call;
  const [recoveryPhrase, setRecoveryPhrase] = useState(null);

  // Hydrate input drafts when the profile finishes loading.
  useEffect(() => {
    if (profile?.handle      != null) setHandleInput(profile.handle);
    if (profile?.displayName != null) setDisplayInput(profile.displayName);
  }, [profile?.handle, profile?.displayName]);

  // Load taxonomy once we have an active agent.
  useEffect(() => {
    if (!svc?.activeBundle) return;
    listSkillCategories('nl').then(setCategories).catch(() => { /* swallow */ });
  }, [svc?.activeBundle, listSkillCategories]);

  // ── Empty state — no agent yet (no group joined). ────────────────
  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{t('profile.heading', 'Mijn profiel')}</Text>
        <Text style={styles.emptyBody}>
          {t('profile.no_group',
             'Sluit eerst aan bij een groep — dan kan je je profiel invullen.')}
        </Text>
      </View>
    );
  }

  // ── Action wrappers ──────────────────────────────────────────────

  const submitHandle = useCallback(async () => {
    const tidy = normaliseHandle(handleInput);
    const v = validateHandle(tidy);
    if (!v.ok) {
      setError(t(`profile.handle_${v.reason}`, _handleErrorFallback(v.reason)));
      return;
    }
    setError(null);
    setBusyKey('handle');
    try {
      await setHandle(tidy);
      setHandleInput(tidy);
      setSavedKey('handle');
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally { setBusyKey(null); }
  }, [handleInput, setHandle]);

  const submitDisplayName = useCallback(async () => {
    setError(null);
    setBusyKey('displayName');
    try {
      await setDisplayName(displayInput);
      setSavedKey('displayName');
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally { setBusyKey(null); }
  }, [displayInput, setDisplayName]);

  const onPickAvatar = useCallback(async (mode) => {
    setError(null);
    try {
      const blob = await pickAvatarImage({ mode });
      if (!blob) return; // user cancelled
      await setAvatar(blob);
    } catch (err) {
      if (err?.code === 'PERMISSION_DENIED') {
        setError(t('compose.permission_denied',
                   'Stoop heeft geen toestemming voor camera/galerij.'));
      } else setError(err?.message ?? String(err));
    }
  }, [setAvatar]);

  const onCaptureLocation = useCallback(async () => {
    setError(null); setBusyKey('location');
    try {
      const { cell, lat, lng } = await getCoarseLocationFromGps();
      await setLocation({ cell, label: null, source: 'gps', lat, lng });
    } catch (err) {
      if (err?.code === 'PERMISSION_DENIED') {
        setError(t('mobile.permission_location_rationale',
                   'Stoop wil je locatie ophalen om afstand-gefilterde posts te tonen.'));
      } else setError(err?.message ?? String(err));
    } finally { setBusyKey(null); }
  }, [setLocation]);

  const refreshPodStatus = useCallback(async () => {
    setPodStatusLoading(true);
    try {
      const r = await podSignInStatusCall({});
      setPodStatus(r ?? { signedIn: false });
    } catch (_err) {
      setPodStatus({ signedIn: false });
    } finally {
      setPodStatusLoading(false);
    }
  }, [podSignInStatusCall]);

  useEffect(() => {
    refreshPodStatus().catch(() => {});
  }, [refreshPodStatus]);

  const handleSignOutOfPod = useCallback(async () => {
    setSignOutBusy(true);
    setSignOutMsg(null);
    try {
      const r = await signOutOfPodCall({});
      if (r?.error) {
        setSignOutMsg(`${t('common.error', 'Fout')}: ${r.error}`);
      } else {
        setSignOutMsg(t('profile.my_pods_signed_out_ok', 'Uitgelogd.'));
        await refreshPodStatus();
      }
    } catch (err) {
      setSignOutMsg(`${t('common.error', 'Fout')}: ${err?.message ?? err}`);
    } finally {
      setSignOutBusy(false);
    }
  }, [signOutOfPodCall, refreshPodStatus]);

  const exportRecovery = useCallback(async () => {
    setError(null);
    try {
      const phrase = await getMnemonicOnce();
      if (!phrase) {
        setError(t('profile.recovery_unavailable',
                   'Recovery export not available in this build.'));
        return;
      }
      setRecoveryPhrase(phrase);
      setShowRecovery(true);
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [getMnemonicOnce]);

  // ── Render ───────────────────────────────────────────────────────

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>{t('profile.heading', 'Mijn profiel')}</Text>
      {loading ? <ActivityIndicator style={{ marginVertical: SPACING.md }} /> : null}
      {hookError ? <Text style={styles.errorText}>{hookError.message}</Text> : null}

      {/* Avatar */}
      <View style={styles.section}>
        <View style={styles.avatarRow}>
          <AvatarCircle uri={profile?.avatarUri} name={profile?.displayName ?? profile?.handle ?? ''} size={72} />
          <View style={styles.avatarActions}>
            <Pressable
              onPress={() => onPickAvatar('camera')}
              style={styles.btnSecondary}
              accessibilityRole="button"
              accessibilityLabel="profile-avatar-camera"
            >
              <Text style={styles.btnSecondaryLabel}>{t('mobile.take_photo', 'Foto maken')}</Text>
            </Pressable>
            <Pressable
              onPress={() => onPickAvatar('library')}
              style={styles.btnSecondary}
              accessibilityRole="button"
              accessibilityLabel="profile-avatar-library"
            >
              <Text style={styles.btnSecondaryLabel}>{t('mobile.pick_from_library', 'Kies uit galerij')}</Text>
            </Pressable>
            {profile?.avatarUri ? (
              <Pressable onPress={clearAvatar} style={styles.btnGhost}>
                <Text style={styles.btnGhostLabel}>{t('profile.avatar_clear', 'Verwijderen')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {/* Handle */}
      <View style={styles.section}>
        <Text style={styles.label}>
          {t('profile.handle_label',
             `Handle (lowercase, ${HANDLE_LIMITS.minLen}-${HANDLE_LIMITS.maxLen} chars)`)}
        </Text>
        <TextInput
          value={handleInput}
          onChangeText={setHandleInput}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={HANDLE_LIMITS.maxLen}
          placeholder={t('profile.handle_placeholder', 'e.g. oosterpoort-bird-23')}
          style={styles.input}
          accessibilityLabel="profile-handle-input"
        />
        <Pressable
          onPress={submitHandle}
          disabled={busyKey === 'handle'}
          style={styles.btnPrimary}
          accessibilityRole="button"
        >
          <Text style={styles.btnPrimaryLabel}>
            {busyKey === 'handle'
              ? t('profile.saving', 'Opslaan…')
              : t('profile.handle_save', 'Handle opslaan')}
          </Text>
        </Pressable>
        {savedKey === 'handle' ? (
          <Text style={styles.success}>
            {t('profile.handle_saved', 'Saved').replace('{handle}', handleInput)}
          </Text>
        ) : null}
      </View>

      {/* Display name */}
      <View style={styles.section}>
        <Text style={styles.label}>
          {t('profile.display_name_label', 'Real / chosen name (optional)')}
        </Text>
        <TextInput
          value={displayInput}
          onChangeText={setDisplayInput}
          maxLength={64}
          placeholder={t('profile.display_name_placeholder', 'e.g. Anne van Dijk')}
          style={styles.input}
          accessibilityLabel="profile-displayname-input"
        />
        <Pressable
          onPress={submitDisplayName}
          disabled={busyKey === 'displayName'}
          style={styles.btnPrimary}
        >
          <Text style={styles.btnPrimaryLabel}>
            {busyKey === 'displayName'
              ? t('profile.saving', 'Opslaan…')
              : t('profile.display_name_save', 'Naam opslaan')}
          </Text>
        </Pressable>
        {savedKey === 'displayName' ? (
          <Text style={styles.success}>
            {t('profile.display_name_saved', 'Opgeslagen')}
          </Text>
        ) : null}
      </View>

      {/* Skills */}
      <View style={styles.section}>
        <Text style={styles.label}>
          {t('profile.skills_heading', 'Mijn skills')}
        </Text>
        <SkillPicker
          categories={categories}
          selected={profile?.offerings ?? []}
          onAdd={(entry)   => addSkill(entry).catch((e) => setError(e?.message ?? String(e)))}
          onRemove={(id)   => removeSkill(id).catch((e) => setError(e?.message ?? String(e)))}
        />
      </View>

      {/* Holiday */}
      <View style={styles.section}>
        <View style={styles.row}>
          <Text style={[styles.label, { flex: 1 }]}>
            {t('profile.holiday_label', 'Vakantie-modus')}
          </Text>
          <Pressable
            onPress={() => setHolidayMode(!profile?.holidayMode).catch((e) => setError(e?.message ?? String(e)))}
            style={[styles.toggle, profile?.holidayMode && styles.toggleActive]}
            accessibilityRole="switch"
            accessibilityState={{ checked: !!profile?.holidayMode }}
          >
            <Text style={styles.toggleLabel}>
              {profile?.holidayMode
                ? t('profile.holiday_on', 'Aan')
                : t('profile.holiday_off', 'Uit')}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          {t('profile.holiday_hint',
             'Verberg je profiel tijdelijk: buren zien je niet als beschikbare match en push-meldingen pauzeren tot je het weer uitzet.')}
        </Text>
      </View>

      {/* Location */}
      <View style={styles.section}>
        <Text style={styles.label}>{t('profile.location_heading', 'Locatie')}</Text>
        <Text style={styles.body}>
          {formatLocationLine(profile?.location)
            ?? t('profile.location_unset', 'Geen locatie ingesteld.')}
        </Text>
        <View style={styles.row}>
          <Pressable
            onPress={onCaptureLocation}
            disabled={busyKey === 'location'}
            style={styles.btnSecondary}
          >
            <Text style={styles.btnSecondaryLabel}>
              {busyKey === 'location'
                ? t('profile.location_busy', 'Ophalen…')
                : t('profile.location_capture', 'Locatie ophalen')}
            </Text>
          </Pressable>
          {profile?.location?.cell ? (
            <Pressable
              onPress={() => clearLocation().catch((e) => setError(e?.message ?? String(e)))}
              style={[styles.btnGhost, { marginLeft: SPACING.sm }]}
            >
              <Text style={styles.btnGhostLabel}>
                {t('profile.location_clear', 'Wissen')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* My Solid pods (C5 / A6 mobile mirror) */}
      <View style={styles.section}>
        <Text style={styles.label}>
          {t('profile.my_pods_heading', 'Mijn Solid-pods')}
        </Text>
        {podStatusLoading ? (
          <Text style={styles.body}>
            {t('profile.my_pods_loading', 'Aan het laden…')}
          </Text>
        ) : podStatus?.signedIn ? (
          <View>
            {podStatus.webid ? (
              <Text style={styles.body} accessibilityLabel="profile-pod-webid">
                WebID: {podStatus.webid}
              </Text>
            ) : null}
            <Text style={styles.body}>
              {podStatus.podAttached
                ? t('profile.my_pods_attached', 'Pod gekoppeld; schrijven gaan synchroon naar de pod.')
                : t('profile.my_pods_detached', 'Aangemeld, pod niet gekoppeld aan deze sessie.')}
            </Text>
            <Pressable
              onPress={handleSignOutOfPod}
              disabled={signOutBusy}
              style={[styles.btnSecondary, signOutBusy && styles.btnDisabled]}
              accessibilityRole="button"
              accessibilityLabel="profile-pod-sign-out"
            >
              <Text style={styles.btnSecondaryLabel}>
                {signOutBusy
                  ? t('profile.my_pods_signing_out', 'Uitloggen…')
                  : t('profile.my_pods_sign_out',   'Uitloggen uit pod')}
              </Text>
            </Pressable>
            {signOutMsg ? <Text style={styles.body}>{signOutMsg}</Text> : null}
            <Text style={styles.body}>
              {t('profile.my_pods_two_pod_deferred_mobile',
                 'Twee-pods-preset komt in V3 (substraat gereed; UI volgt).')}
            </Text>
          </View>
        ) : (
          <Text style={styles.body}>
            {t('profile.my_pods_signed_out_intro_mobile',
               'Geen pod aan dit account gekoppeld. Stoop werkt prima zonder; pod-koppeling is optioneel.')}
          </Text>
        )}
      </View>

      {/* Recovery phrase */}
      <View style={styles.section}>
        <Text style={styles.label}>
          {t('profile.recovery_heading', 'Herstelzin')}
        </Text>
        <Text style={styles.body}>
          {t('profile.recovery_intro',
             'Bewaar je herstelzin op een veilige plek. Je hebt hem nodig om Stoop op een ander toestel te installeren.')}
        </Text>
        <Pressable onPress={exportRecovery} style={styles.btnSecondary}>
          <Text style={styles.btnSecondaryLabel}>
            {t('profile.recovery_show', 'Toon herstelzin')}
          </Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <ConfirmModal
        visible={showRecovery && !!recoveryPhrase}
        title={t('profile.recovery_heading', 'Herstelzin')}
        body={recoveryPhrase ?? ''}
        confirmLabel={t('profile.recovery_close', 'Sluiten')}
        cancelLabel={t('profile.recovery_close', 'Sluiten')}
        onConfirm={() => setShowRecovery(false)}
        onCancel={() => setShowRecovery(false)}
      />
    </ScrollView>
  );
}

function _handleErrorFallback(reason) {
  switch (reason) {
    case 'empty':     return 'Handle is verplicht.';
    case 'too_short': return 'Handle is te kort (3-32 tekens).';
    case 'too_long':  return 'Handle is te lang (3-32 tekens).';
    case 'bad_chars': return 'Alleen kleine letters, cijfers, - en _.';
    default:          return 'Handle is ongeldig.';
  }
}

export default ProfileMineScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: SPACING.xl, backgroundColor: COLORS.background,
  },
  emptyTitle: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  emptyBody:  { fontSize: FONT_SIZES.md, color: COLORS.textMuted, textAlign: 'center' },
  section: {
    marginBottom: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  avatarRow:    { flexDirection: 'row', alignItems: 'center' },
  avatarActions:{ marginLeft: SPACING.lg, flex: 1 },
  label:        { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm },
  body:         { fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.sm, lineHeight: 20 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  btnPrimary: {
    backgroundColor: COLORS.primary, paddingVertical: SPACING.md,
    borderRadius: RADII.sm, alignItems: 'center',
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted, paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg, borderRadius: RADII.sm, alignItems: 'center',
    marginRight: SPACING.sm, marginTop: SPACING.sm,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  btnGhost: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, marginTop: SPACING.sm },
  btnGhostLabel: { color: COLORS.danger, fontSize: FONT_SIZES.sm, fontWeight: '500' },
  toggle: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADII.pill, backgroundColor: COLORS.surfaceMuted,
  },
  toggleActive: { backgroundColor: COLORS.primary },
  toggleLabel:  { color: COLORS.text, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  success:    { color: COLORS.success, fontSize: FONT_SIZES.sm, marginTop: SPACING.sm },
  errorText:  {
    color: COLORS.danger, fontSize: FONT_SIZES.sm,
    marginVertical: SPACING.md, paddingHorizontal: SPACING.lg,
  },
});

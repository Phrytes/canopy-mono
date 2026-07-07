/**
 * CreateCrewScreen — full create-crew wizard with §II.2 storage-policy
 * picker + optional group pod URI.
 *
 * M1-S2 (2026-05-18). Mirrors tasks-v0's `/welcome.html` create-crew
 * wizard and stoop-mobile's CreateGroupScreen 4-radio policy picker.
 *
 * Flow:
 *   1. Name + kind (5 chips)
 *   2. Crew ID slug (auto-generated from name, editable)
 *   3. Storage policy (4 radios: no-pod / centralised / decentralised
 *      / hybrid) with per-policy hints
 *   4. Group pod URI (shown only for centralised / hybrid)
 *   → calls `provisionMyCrew` skill then `joinCrew`
 *   → resets stack to Main + OnboardIssue (freshlyCreated=true)
 *
 * Note: WelcomeScreen has its own quick-create modal for the common
 * "create with default (no-pod) policy" path. This screen is for
 * users who want to pick a storage policy before creating.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useSkill }   from '../lib/useSkill.js';
import { useLocalisation }    from '../LocalisationProvider.js';
import { ROUTES }     from '../navigation.js';

const CREW_ID_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/;

/** Slugify a name into a valid crew-id proposal. */
function _slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    || `crew-${Date.now().toString(36)}`;
}

const CREW_KINDS = ['household', 'project', 'team', 'friends', 'maintenance'];
const STORAGE_POLICIES = ['no-pod', 'centralised', 'decentralised', 'hybrid'];

export function CreateCrewScreen() {
  const nav        = useNavigation();
  const svc        = useService();
  const { t }      = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const provisionMyCrew = useSkill('provisionMyCrew');

  const [name,          setName]          = useState('');
  const [circleId,        setCircleId]        = useState('');
  const [kind,          setKind]          = useState('household');
  const [policy,        setPolicy]        = useState('no-pod');
  const [groupPodUri,   setGroupPodUri]   = useState('');
  const [busy,          setBusy]          = useState(false);
  const [error,         setError]         = useState(null);

  const onNameChange = useCallback((text) => {
    setName(text);
    setCircleId(_slugify(text));
  }, []);

  const needsPodUri = policy === 'centralised' || policy === 'hybrid';

  const canSubmit = name.trim().length > 0
    && CREW_ID_RE.test(circleId)
    && !busy;

  const onSubmit = useCallback(async () => {
    if (!canSubmit || !svc?.joinCrew) return;
    setBusy(true);
    setError(null);
    try {
      const actor  = svc?.identity?.webid ?? `webid://local-${(svc?.identity?.pubKey ?? 'anon').slice(0, 12)}`;
      const pubKey = svc?.identity?.pubKey ?? 'local';

      const storage = needsPodUri && groupPodUri.trim()
        ? { policy, groupPodUri: groupPodUri.trim() }
        : { policy, groupPodUri: null };

      // provisionMyCrew persists the config to local-store so it
      // survives restarts. joinCrew builds the runtime CrewState.
      if (provisionMyCrew?.call) {
        await provisionMyCrew.call({
          circleId:  circleId.trim(),
          name:    name.trim(),
          kind,
          storage,
          members: [{ webid: actor, displayName: 'Me', pubKey, role: 'admin' }],
          customRoles: [],
        });
      }

      await svc.joinCrew({
        circleId:  circleId.trim(),
        name:    name.trim(),
        kind,
        storage,
        members: [{ webid: actor, displayName: 'Me', pubKey, role: 'admin' }],
        customRoles: [],
      }, { setActive: true });

      nav.reset({
        index: 1,
        routes: [
          { name: ROUTES.Main },
          { name: ROUTES.OnboardIssue, params: { freshlyCreated: true } },
        ],
      });
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [canSubmit, svc, provisionMyCrew, circleId, name, kind, policy, groupPodUri, needsPodUri, nav]);

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        backgroundColor: COLORS.background,
        padding: SPACING.xl,
      }}
    >
      <Text style={{ fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm }}>
        {t('mobile.create_crew.title', 'Create a new crew')}
      </Text>
      <Text style={{ fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.xl, lineHeight: 20 }}>
        {t('mobile.create_crew.subtitle', 'Choose a storage policy before creating.')}
      </Text>

      {/* Crew name */}
      <SectionLabel label={t('mobile.create_crew.name_label', 'Crew name')} required />
      <TextInput
        value={name}
        onChangeText={onNameChange}
        placeholder={t('mobile.create_crew.name_placeholder', 'My household')}
        placeholderTextColor={COLORS.textMuted}
        accessibilityLabel="create-crew-name"
        style={_inputStyle(COLORS, SPACING, FONT_SIZES, RADII)}
      />

      {/* Crew ID */}
      <SectionLabel label={t('mobile.create_crew.id_label', 'Crew ID (slug)')} />
      <TextInput
        value={circleId}
        onChangeText={setCircleId}
        placeholder="my-household"
        placeholderTextColor={COLORS.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="create-crew-id"
        style={[
          _inputStyle(COLORS, SPACING, FONT_SIZES, RADII),
          !CREW_ID_RE.test(circleId) && circleId.length > 0 && { borderColor: COLORS.danger },
        ]}
      />
      {!CREW_ID_RE.test(circleId) && circleId.length > 0 ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.xs, marginTop: SPACING.xs }}>
          {t('mobile.create_crew.id_error', 'Use lowercase letters, digits and hyphens only.')}
        </Text>
      ) : null}

      {/* Crew kind */}
      <SectionLabel label={t('mobile.create_crew.kind_label', 'Crew type')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: SPACING.lg }}>
        {CREW_KINDS.map((k) => (
          <Chip
            key={k}
            label={t(`mobile.crews.kind_${k}`, k)}
            active={kind === k}
            onPress={() => setKind(k)}
            accessibilityLabel={`create-crew-kind-${k}`}
          />
        ))}
      </View>

      {/* Storage policy */}
      <SectionLabel label={t('mobile.create_crew.policy_label', 'Storage policy')} />
      <View style={{ marginBottom: SPACING.lg }}>
        {STORAGE_POLICIES.map((p) => {
          const active = policy === p;
          return (
            <Pressable
              key={p}
              onPress={() => setPolicy(p)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`create-crew-policy-${p}`}
              style={{
                flexDirection: 'row', alignItems: 'flex-start',
                paddingVertical: SPACING.md, paddingHorizontal: SPACING.md,
                borderRadius: RADII.sm, marginBottom: SPACING.sm,
                borderWidth: 1,
                borderColor: active ? COLORS.primaryDark : COLORS.border,
                backgroundColor: active ? COLORS.primaryLight ?? COLORS.surface : COLORS.surface,
              }}
            >
              <View style={{
                width: 18, height: 18, borderRadius: 9, borderWidth: 2,
                borderColor: active ? COLORS.primary : COLORS.border,
                backgroundColor: active ? COLORS.primary : 'transparent',
                marginRight: SPACING.md, marginTop: 2,
              }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', color: COLORS.text, fontSize: FONT_SIZES.md }}>
                  {t(`mobile.create_crew.policy_${p}`, p)}
                </Text>
                <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 }}>
                  {t(`mobile.create_crew.policy_hint_${p}`, '')}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Group pod URI — centralised / hybrid only */}
      {needsPodUri ? (
        <>
          <SectionLabel label={t('mobile.create_crew.pod_uri_label', 'Group pod URI')} />
          <TextInput
            value={groupPodUri}
            onChangeText={setGroupPodUri}
            placeholder="https://pod.example/groups/my-crew/"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="create-crew-pod-uri"
            style={[_inputStyle(COLORS, SPACING, FONT_SIZES, RADII), { marginBottom: SPACING.lg }]}
          />
        </>
      ) : null}

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md }}>
          {error}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: SPACING.md }}>
        <Pressable
          onPress={() => nav.goBack()}
          accessibilityRole="button"
          style={{
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
            borderRadius: RADII.sm, marginRight: SPACING.sm,
            backgroundColor: COLORS.surfaceMuted,
          }}
        >
          <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md }}>
            {t('mobile.common.cancel')}
          </Text>
        </Pressable>
        <Pressable
          onPress={onSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="create-crew-submit"
          style={{
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
            borderRadius: RADII.sm,
            backgroundColor: canSubmit ? COLORS.primary : COLORS.surfaceMuted,
          }}
        >
          {busy ? (
            <ActivityIndicator color={COLORS.textInverse} />
          ) : (
            <Text style={{
              color: canSubmit ? COLORS.textInverse : COLORS.textMuted,
              fontSize: FONT_SIZES.md, fontWeight: '600',
            }}>
              {t('mobile.create_crew.submit', 'Create + invite')}
            </Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

function SectionLabel({ label, required }) {
  const { COLORS, SPACING, FONT_SIZES } = useTheme();
  return (
    <Text style={{
      fontSize: FONT_SIZES.sm, fontWeight: '500', color: COLORS.text,
      marginBottom: SPACING.xs, marginTop: SPACING.sm,
    }}>
      {label}{required ? ' *' : ''}
    </Text>
  );
}

function Chip({ label, active, onPress, accessibilityLabel }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
      style={{
        paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm,
        borderRadius: RADII.pill, borderWidth: 1,
        borderColor: active ? COLORS.primaryDark : COLORS.border,
        backgroundColor: active ? COLORS.primary : COLORS.surface,
        marginRight: SPACING.xs, marginBottom: SPACING.xs,
      }}
    >
      <Text style={{
        color: active ? COLORS.textInverse : COLORS.text,
        fontSize: FONT_SIZES.xs, fontWeight: active ? '600' : '500',
      }}>
        {label}
      </Text>
    </Pressable>
  );
}

function _inputStyle(COLORS, SPACING, FONT_SIZES, RADII) {
  return {
    borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADII.sm, padding: SPACING.md,
    fontSize: FONT_SIZES.md, color: COLORS.text,
    backgroundColor: COLORS.surface, marginBottom: SPACING.md,
  };
}

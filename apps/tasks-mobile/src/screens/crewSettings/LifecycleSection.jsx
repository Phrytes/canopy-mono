/**
 * LifecycleSection — admin-only crew lifecycle controls.
 *
 * Phase 41.18.2 (2026-05-10).
 *
 * Wraps the four crewControls skills:
 *   - pauseCrew    — soft-disables addTask + dispatch
 *   - unpauseCrew  — undo
 *   - archiveCrew  — read-only state (still listed in CrewsDashboard)
 *   - unarchiveCrew
 *
 * Renders the current state ("active" / "paused" / "archived") + a
 * single contextual CTA pair. Members see a read-only label so they
 * understand why addTask is failing, but no toggles.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';

import { useTheme }    from '@canopy/react-native/theme';
import { ConfirmModal } from '@canopy/react-native/components';
import { useService }  from '../../ServiceContext.js';
import { useSkill }    from '../../lib/useSkill.js';
import { useLocalisation }     from '../../LocalisationProvider.js';
import { useActiveRole } from '../../lib/useActiveRole.js';

export function LifecycleSection() {
  const svc          = useService();
  const { isAdmin }  = useActiveRole();
  const { t }        = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const cs       = svc?.activeCrewId ? svc.crews.get(svc.activeCrewId) : null;
  const live     = cs?.liveCrew ?? {};
  const archived = !!live.archived;
  const paused   = !!live.paused;
  const stateKey = archived ? 'archived' : paused ? 'paused' : 'active';

  const pauseSk     = useSkill('pauseCrew');
  const unpauseSk   = useSkill('unpauseCrew');
  const archiveSk   = useSkill('archiveCrew');
  const unarchiveSk = useSkill('unarchiveCrew');

  const [busy,           setBusy]           = useState(false);
  const [error,          setError]          = useState(null);
  const [showArchive,    setShowArchive]    = useState(false);
  const [showUnarchive,  setShowUnarchive]  = useState(false);

  const _withErr = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r?.error) setError(String(r.error));
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const onPause     = useCallback(() => _withErr(() => pauseSk.call({})),     [_withErr, pauseSk]);
  const onUnpause   = useCallback(() => _withErr(() => unpauseSk.call({})),   [_withErr, unpauseSk]);
  const onArchive   = useCallback(async () => {
    setShowArchive(false);
    await _withErr(() => archiveSk.call({}));
  }, [_withErr, archiveSk]);
  const onUnarchive = useCallback(async () => {
    setShowUnarchive(false);
    await _withErr(() => unarchiveSk.call({}));
  }, [_withErr, unarchiveSk]);

  if (!isAdmin) {
    return (
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
        {t(`mobile.crew_settings.lifecycle_state_${stateKey}_member`)}
      </Text>
    );
  }

  return (
    <View>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        marginBottom: SPACING.md,
      }}>
        <View style={{
          paddingVertical: 2, paddingHorizontal: SPACING.sm,
          borderRadius: RADII.pill,
          backgroundColor:
            stateKey === 'archived' ? COLORS.danger
              : stateKey === 'paused' ? COLORS.warning
                : COLORS.success,
          marginRight: SPACING.sm,
        }}>
          <Text style={{
            color: COLORS.textInverse,
            fontSize: FONT_SIZES.xs, fontWeight: '600',
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {t(`mobile.crew_settings.lifecycle_state_${stateKey}`)}
          </Text>
        </View>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, flex: 1 }}>
          {t(`mobile.crew_settings.lifecycle_hint_${stateKey}`)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
        {!archived && !paused ? (
          <CtaBtn
            label={t('mobile.crew_settings.lifecycle_pause')}
            onPress={onPause}
            disabled={busy}
            variant="warning"
          />
        ) : null}
        {!archived && paused ? (
          <CtaBtn
            label={t('mobile.crew_settings.lifecycle_unpause')}
            onPress={onUnpause}
            disabled={busy}
            variant="primary"
          />
        ) : null}
        {!archived ? (
          <CtaBtn
            label={t('mobile.crew_settings.lifecycle_archive')}
            onPress={() => setShowArchive(true)}
            disabled={busy}
            variant="danger"
          />
        ) : (
          <CtaBtn
            label={t('mobile.crew_settings.lifecycle_unarchive')}
            onPress={() => setShowUnarchive(true)}
            disabled={busy}
            variant="primary"
          />
        )}
      </View>

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.sm }}>
          {error}
        </Text>
      ) : null}

      <ConfirmModal
        visible={showArchive}
        title={t('mobile.crew_settings.lifecycle_archive_confirm_title')}
        body={t('mobile.crew_settings.lifecycle_archive_confirm_body')}
        confirmLabel={t('mobile.crew_settings.lifecycle_archive')}
        destructive
        onConfirm={onArchive}
        onCancel={() => setShowArchive(false)}
      />
      <ConfirmModal
        visible={showUnarchive}
        title={t('mobile.crew_settings.lifecycle_unarchive_confirm_title')}
        body={t('mobile.crew_settings.lifecycle_unarchive_confirm_body')}
        confirmLabel={t('mobile.crew_settings.lifecycle_unarchive')}
        onConfirm={onUnarchive}
        onCancel={() => setShowUnarchive(false)}
      />
    </View>
  );
}

function CtaBtn({ label, onPress, disabled, variant }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  const bg = disabled ? COLORS.surfaceMuted
           : variant === 'danger'  ? COLORS.danger
           : variant === 'warning' ? COLORS.warning
           : COLORS.primary;
  const fg = disabled ? COLORS.textMuted : COLORS.textInverse;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`lifecycle-cta-${label}`}
      style={({ pressed }) => [
        {
          paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
          borderRadius: RADII.pill,
          backgroundColor: bg,
        },
        pressed && !disabled && { opacity: 0.85 },
      ]}
    >
      <Text style={{ color: fg, fontSize: FONT_SIZES.sm, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

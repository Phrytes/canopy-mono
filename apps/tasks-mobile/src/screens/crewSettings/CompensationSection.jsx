/**
 * CompensationSection — V2.2 invoicing config + per-month rollup.
 *
 * Phase 41.8.5 (2026-05-09).
 *
 * Admin sees the enable toggle + per-member compensated/rate inputs +
 * a per-pro per-month rollup. Self-paid-pro can see + read their own
 * monthly rollup but not edit anyone else's settings.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, TextInput, Pressable } from 'react-native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../../ServiceContext.js';
import { useSkill, useSkillResult } from '../../lib/useSkill.js';
import { useLocalisation }    from '../../LocalisationProvider.js';
import { useActiveRole } from '../../lib/useActiveRole.js';

export function CompensationSection() {
  const svc = useService();
  const { isAdmin, actor } = useActiveRole();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const cs = svc?.activeCircleId ? svc.crews.get(svc.activeCircleId) : null;
  const liveCrew = cs?.liveCrew ?? null;
  const enabled  = !!liveCrew?.compensation?.enabled;
  const members  = liveCrew?.members ?? [];

  const setEnabled = useSkill('setCompensationEnabled');
  const setMember  = useSkill('setMemberCompensation');
  const myRollup   = useSkillResult('getCompensation', { memberWebid: actor }, [svc?.activeCircleId, actor]);

  const onToggleEnabled = useCallback(async (next) => {
    if (!isAdmin) return;
    await setEnabled.call({ enabled: !!next }).catch(() => {});
    // The crew config will refresh through the next ServiceContext-level
    // crewMutator pass; for V1.0 we rely on parent-screen refresh.
  }, [isAdmin, setEnabled]);

  const onToggleMember = useCallback(async (memberWebid, compensated) => {
    if (!isAdmin) return;
    await setMember.call({ memberWebid, compensated, rate: undefined }).catch(() => {});
  }, [isAdmin, setMember]);

  const onSetRate = useCallback(async (memberWebid, rateText) => {
    if (!isAdmin) return;
    const rate = Number(rateText);
    if (!Number.isFinite(rate)) return;
    await setMember.call({ memberWebid, compensated: true, rate }).catch(() => {});
  }, [isAdmin, setMember]);

  if (!isAdmin && !enabled) {
    return (
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
        {t('mobile.crew_settings.compensation_disabled')}
      </Text>
    );
  }

  return (
    <View>
      {isAdmin ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: SPACING.md,
        }}>
          <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
            {t('mobile.crew_settings.compensation_enable_label')}
          </Text>
          <Switch
            value={enabled}
            onValueChange={onToggleEnabled}
            accessibilityLabel="compensation-enable-toggle"
          />
        </View>
      ) : null}

      {enabled && isAdmin ? (
        <View>
          {members.map((m) => (
            <MemberRow
              key={m.webid}
              member={m}
              onToggle={(c) => onToggleMember(m.webid, c)}
              onSetRate={(r) => onSetRate(m.webid, r)}
              colors={COLORS} sp={SPACING} fz={FONT_SIZES} ra={RADII}
              t={t}
            />
          ))}
        </View>
      ) : null}

      {enabled && !isAdmin && myRollup?.data ? (
        <RollupSummary rollup={myRollup.data} colors={COLORS} sp={SPACING} fz={FONT_SIZES} t={t} />
      ) : null}
    </View>
  );
}

function MemberRow({ member, onToggle, onSetRate, colors, sp, fz, ra, t }) {
  const [rate, setRate] = useState(String(member?.rate ?? ''));
  useEffect(() => { setRate(String(member?.rate ?? '')); }, [member?.rate]);
  return (
    <View style={{
      paddingVertical: sp.sm, paddingHorizontal: sp.md,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: ra.sm, marginBottom: 4,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontSize: fz.sm, fontWeight: '500' }}>
          {member.displayName ?? _suffix(member.webid)}
        </Text>
        <Switch
          value={!!member.compensated}
          onValueChange={onToggle}
          accessibilityLabel={`compensation-toggle-${member.webid}`}
        />
      </View>
      {member.compensated ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: sp.sm }}>
          <Text style={{ color: colors.textMuted, fontSize: fz.xs, marginRight: sp.sm }}>
            {t('mobile.crew_settings.compensation_rate_label')}
          </Text>
          <TextInput
            value={rate}
            onChangeText={setRate}
            onBlur={() => onSetRate(rate)}
            keyboardType="numeric"
            accessibilityLabel={`compensation-rate-${member.webid}`}
            style={{
              flex: 1,
              borderWidth: 1, borderColor: colors.border, borderRadius: ra.sm,
              padding: sp.sm, color: colors.text, fontSize: fz.sm,
              backgroundColor: colors.surface,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function RollupSummary({ rollup, colors, sp, fz, t }) {
  const totals = rollup?.totals ?? {};
  return (
    <View style={{
      padding: sp.md, borderWidth: 1, borderColor: colors.border, borderRadius: 4,
      backgroundColor: colors.surface,
    }}>
      <Text style={{ color: colors.text, fontSize: fz.sm, fontWeight: '600', marginBottom: sp.sm }}>
        {t('mobile.crew_settings.compensation_rollup_title')}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: fz.xs }}>
        {t('mobile.crew_settings.compensation_rollup_count', null).replace('{count}', String(totals.count ?? 0))}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: fz.xs }}>
        {t('mobile.crew_settings.compensation_rollup_hours', null).replace('{hours}', String(totals.hours ?? 0))}
      </Text>
      {Number.isFinite(totals.amount) ? (
        <Text style={{ color: colors.textMuted, fontSize: fz.xs }}>
          {t('mobile.crew_settings.compensation_rollup_amount', null)
            .replace('{amount}', String(totals.amount))
            .replace('{currency}', rollup?.currency ?? '€')}
        </Text>
      ) : null}
    </View>
  );
}

function _suffix(webid) {
  if (typeof webid !== 'string') return '?';
  const i = webid.lastIndexOf('/');
  return i >= 0 ? webid.slice(i + 1) : webid;
}

/**
 * CustomRolesSection — V1.5 custom-role registry per crew.
 *
 * Phase 41.8.3 (2026-05-09).
 *
 * Admin-only. Lists known custom roles + lets the admin add/remove.
 * Each custom role has an id (string) + rank (number — Q-H4.7 (c)
 * extension path).
 */

import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';

import { useTheme } from '@canopy/react-native/theme';
import { useSkill, useSkillResult } from '../../lib/useSkill.js';
import { useI18n }    from '../../I18nProvider.js';
import { useActiveRole } from '../../lib/useActiveRole.js';

export function CustomRolesSection() {
  const { isAdmin } = useActiveRole();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const list = useSkillResult('listKnownRoles', {});
  const reg  = useSkill('registerCrewCustomRole');
  const unreg = useSkill('unregisterCrewCustomRole');

  const [id, setId]     = useState('');
  const [rank, setRank] = useState('5');
  const [error, setError] = useState(null);

  const items = Array.isArray(list?.data?.roles) ? list.data.roles
              : Array.isArray(list?.data?.customRoles) ? list.data.customRoles
              : [];
  const customs = items.filter((r) => r?.kind === 'custom' || r?.custom === true || r?.standard === false);

  const onAdd = useCallback(async () => {
    const trimmed = id.trim();
    const r = Number(rank);
    if (!trimmed || !Number.isFinite(r)) return;
    setError(null);
    try {
      const res = await reg.call({ id: trimmed, rank: r });
      if (res?.error) { setError(res.error); return; }
      setId(''); setRank('5');
      list.refresh().catch(() => {});
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [id, rank, reg, list]);

  const onRemove = useCallback(async (roleId) => {
    setError(null);
    try {
      const res = await unreg.call({ id: roleId });
      if (res?.error) { setError(res.error); return; }
      list.refresh().catch(() => {});
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [unreg, list]);

  if (!isAdmin) {
    return (
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
        {t('mobile.crew_settings.admin_only')}
      </Text>
    );
  }

  return (
    <View>
      {customs.length === 0 ? (
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md }}>
          {t('mobile.crew_settings.custom_roles_empty')}
        </Text>
      ) : customs.map((r) => (
        <View
          key={r.id}
          style={{
            flexDirection: 'row', alignItems: 'center',
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
            backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
            borderRadius: RADII.sm, marginBottom: 4,
          }}
        >
          <Text style={{ flex: 1, color: COLORS.text, fontSize: FONT_SIZES.sm }}>
            {r.id}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginRight: SPACING.md }}>
            rank {r.rank}
          </Text>
          <Pressable
            onPress={() => onRemove(r.id)}
            accessibilityRole="button"
            accessibilityLabel={`custom-role-remove-${r.id}`}
            style={{
              paddingVertical: 4, paddingHorizontal: SPACING.sm,
              borderRadius: RADII.pill, backgroundColor: COLORS.danger,
            }}
          >
            <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.xs }}>
              {t('mobile.common.delete')}
            </Text>
          </Pressable>
        </View>
      ))}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.md }}>
        <TextInput
          value={id}
          onChangeText={setId}
          placeholder={t('mobile.crew_settings.custom_role_id_placeholder')}
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          accessibilityLabel="custom-role-id-input"
          style={{
            flex: 2,
            borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
            padding: SPACING.sm, color: COLORS.text, backgroundColor: COLORS.surface,
            fontSize: FONT_SIZES.sm,
          }}
        />
        <TextInput
          value={rank}
          onChangeText={setRank}
          keyboardType="numeric"
          accessibilityLabel="custom-role-rank-input"
          style={{
            width: 60,
            borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
            padding: SPACING.sm, color: COLORS.text, backgroundColor: COLORS.surface,
            fontSize: FONT_SIZES.sm,
          }}
        />
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="custom-role-add"
          style={{
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md,
            borderRadius: RADII.pill, backgroundColor: COLORS.primary,
          }}
        >
          <Text style={{ color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '600' }}>
            {t('mobile.crew_settings.custom_role_add')}
          </Text>
        </Pressable>
      </View>

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.xs, marginTop: SPACING.sm }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * CircleSettingsScreen — top-level container for the six per-circle
 * admin/settings panels.
 *
 * Phase 41.8.1 (2026-05-09).
 *
 * Each section is its own component (src/screens/circleSettings/*.jsx)
 * — keeps this screen thin and the sections independently testable.
 * Sections gate themselves by role via `useActiveRole`; this screen
 * just lays them out.
 */

import React from 'react';
import { View, Text, ScrollView } from 'react-native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useLocalisation }    from '../LocalisationProvider.js';

import { MembersSection }            from './circleSettings/MembersSection.jsx';
import { CustomRolesSection }        from './circleSettings/CustomRolesSection.jsx';
import { BotBindingsSection }        from './circleSettings/BotBindingsSection.jsx';
import { CompensationSection }       from './circleSettings/CompensationSection.jsx';
import { CalendarSyncSection }       from './circleSettings/CalendarSyncSection.jsx';
import { AvailabilityAdminSection }  from './circleSettings/AvailabilityAdminSection.jsx';
import { LifecycleSection }          from './circleSettings/LifecycleSection.jsx';
import { CircleConfigSection }         from './circleSettings/CircleConfigSection.jsx';
import { CadenceSection }            from './circleSettings/CadenceSection.jsx';

export function CircleSettingsScreen() {
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  if (!svc?.activeCircleId) {
    return (
      <View style={{ flex: 1, padding: SPACING.xl, backgroundColor: COLORS.background }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.md }}>
          {t('mobile.circle_settings.no_active_circle')}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.lg }}
    >
      <Section title={t('mobile.circle_settings.section_lifecycle')}>
        <LifecycleSection />
      </Section>
      <Section title={t('mobile.circle_settings.section_members')}>
        <MembersSection />
      </Section>
      <Section title={t('mobile.circle_settings.section_custom_roles')}>
        <CustomRolesSection />
      </Section>
      <Section title={t('mobile.circle_settings.section_bot_bindings')}>
        <BotBindingsSection />
      </Section>
      <Section title={t('mobile.circle_settings.section_compensation')}>
        <CompensationSection />
      </Section>
      <Section title={t('mobile.circle_settings.section_calendar_sync')}>
        <CalendarSyncSection />
      </Section>
      <Section title={t('mobile.circle_settings.section_availability_admin')}>
        <AvailabilityAdminSection />
      </Section>
      <Section title={t('mobile.circle_settings.section_cadence')}>
        <CadenceSection />
      </Section>
      <Section title={t('mobile.circle_settings.section_circle_config')}>
        <CircleConfigSection />
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  return (
    <View style={{
      marginBottom: SPACING.xl,
      padding: SPACING.md,
      borderRadius: RADII.md,
      backgroundColor: COLORS.surfaceMuted,
    }}>
      <Text style={{
        fontSize: FONT_SIZES.md, fontWeight: '600',
        color: COLORS.text, marginBottom: SPACING.md,
      }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

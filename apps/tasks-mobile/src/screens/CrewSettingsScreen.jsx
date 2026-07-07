/**
 * CrewSettingsScreen — top-level container for the six per-crew
 * admin/settings panels.
 *
 * Phase 41.8.1 (2026-05-09).
 *
 * Each section is its own component (src/screens/crewSettings/*.jsx)
 * — keeps this screen thin and the sections independently testable.
 * Sections gate themselves by role via `useActiveRole`; this screen
 * just lays them out.
 */

import React from 'react';
import { View, Text, ScrollView } from 'react-native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useLocalisation }    from '../LocalisationProvider.js';

import { MembersSection }            from './crewSettings/MembersSection.jsx';
import { CustomRolesSection }        from './crewSettings/CustomRolesSection.jsx';
import { BotBindingsSection }        from './crewSettings/BotBindingsSection.jsx';
import { CompensationSection }       from './crewSettings/CompensationSection.jsx';
import { CalendarSyncSection }       from './crewSettings/CalendarSyncSection.jsx';
import { AvailabilityAdminSection }  from './crewSettings/AvailabilityAdminSection.jsx';
import { LifecycleSection }          from './crewSettings/LifecycleSection.jsx';
import { CrewConfigSection }         from './crewSettings/CrewConfigSection.jsx';
import { CadenceSection }            from './crewSettings/CadenceSection.jsx';

export function CrewSettingsScreen() {
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  if (!svc?.activeCircleId) {
    return (
      <View style={{ flex: 1, padding: SPACING.xl, backgroundColor: COLORS.background }}>
        <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.md }}>
          {t('mobile.crew_settings.no_active_crew')}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.lg }}
    >
      <Section title={t('mobile.crew_settings.section_lifecycle')}>
        <LifecycleSection />
      </Section>
      <Section title={t('mobile.crew_settings.section_members')}>
        <MembersSection />
      </Section>
      <Section title={t('mobile.crew_settings.section_custom_roles')}>
        <CustomRolesSection />
      </Section>
      <Section title={t('mobile.crew_settings.section_bot_bindings')}>
        <BotBindingsSection />
      </Section>
      <Section title={t('mobile.crew_settings.section_compensation')}>
        <CompensationSection />
      </Section>
      <Section title={t('mobile.crew_settings.section_calendar_sync')}>
        <CalendarSyncSection />
      </Section>
      <Section title={t('mobile.crew_settings.section_availability_admin')}>
        <AvailabilityAdminSection />
      </Section>
      <Section title={t('mobile.crew_settings.section_cadence')}>
        <CadenceSection />
      </Section>
      <Section title={t('mobile.crew_settings.section_crew_config')}>
        <CrewConfigSection />
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

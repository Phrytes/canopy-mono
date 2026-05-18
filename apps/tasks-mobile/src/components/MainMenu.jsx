/**
 * MainMenu — hamburger-overlay menu for the secondary nav surfaces
 * that don't fit on the bottom-tab bar.
 *
 * Phase 41.18 follow-up (2026-05-10).
 *
 * Why this exists: after Phase 41.18 added a dozen screens
 * (CrewSettings, EditSkills, CadenceOverrides, Metrics, Privacy,
 * Availability, …), only a handful had entry points. The bottom-tab
 * bar takes 5 slots; everything else needs a single discoverable
 * surface. This is a slide-from-left drawer-style modal listing the
 * secondary destinations + Sign-in / Pod / About bits.
 *
 * Keep it lightweight — no animation library, no react-navigation
 * drawer dep. Just a Modal + a tap-outside-to-close pattern.
 *
 * Mounts in App.js's MainTabs as a `headerLeft` ≡ button. Visibility
 * is controlled by a hook (`useMainMenu`) rather than passed via
 * props so the trigger can live anywhere.
 */

import React, { createContext, useCallback, useContext, useState } from 'react';
import {
  View, Text, Pressable, Modal, ScrollView, Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useI18n }    from '../I18nProvider.js';
import { ROUTES }     from '../navigation.js';

const MainMenuContext = createContext(null);

export function MainMenuProvider({ children }) {
  const [open, setOpen] = useState(false);
  const value = {
    open,
    show: useCallback(() => setOpen(true),  []),
    hide: useCallback(() => setOpen(false), []),
  };
  return (
    <MainMenuContext.Provider value={value}>
      {children}
      <MainMenu />
    </MainMenuContext.Provider>
  );
}

export function useMainMenu() {
  return useContext(MainMenuContext) ?? { open: false, show: () => {}, hide: () => {} };
}

/**
 * The trigger — ≡ icon. Use this in tab headers (`headerLeft`).
 */
export function MainMenuButton() {
  const { show } = useMainMenu();
  const { COLORS } = useTheme();
  return (
    <Pressable
      onPress={show}
      accessibilityRole="button"
      accessibilityLabel="main-menu-open"
      style={{ paddingHorizontal: 12, paddingVertical: 8 }}
    >
      <Ionicons name="menu" size={26} color={COLORS.text} />
    </Pressable>
  );
}

function MainMenu() {
  const { open, hide } = useMainMenu();
  const nav  = useNavigation();
  const svc  = useService();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const go = useCallback((route, params) => {
    hide();
    nav.navigate(route, params);
  }, [hide, nav]);

  if (!open) return null;

  const podSignedIn = !!svc?.podStatus?.signedIn;
  const activeCrewId = svc?.activeCrewId;
  const activeCrew   = activeCrewId ? svc?.crews?.get?.(activeCrewId) : null;

  const sections = [
    {
      title: t('mobile.main_menu.section_me', 'Me'),
      items: [
        {
          icon: 'person-outline',
          label: t('mobile.main_menu.profile', 'Profile'),
          onPress: () => go(ROUTES.ProfileMine),
        },
        {
          icon: 'calendar-outline',
          label: t('mobile.main_menu.availability', 'My availability'),
          onPress: () => go(ROUTES.Availability),
        },
        {
          icon: 'sparkles-outline',
          label: t('mobile.main_menu.edit_skills', 'My skills (this crew)'),
          onPress: () => go(ROUTES.EditSkills),
          disabled: !activeCrewId,
        },
      ],
    },
    {
      title: t('mobile.main_menu.section_crew', 'Crew') +
        (activeCrew?.liveCrew?.name ? ` · ${activeCrew.liveCrew.name}` : ''),
      items: [
        {
          icon: 'settings-outline',
          label: t('mobile.main_menu.crew_settings', 'Crew settings'),
          onPress: () => go(ROUTES.CrewSettings),
          disabled: !activeCrewId,
        },
        {
          icon: 'git-network-outline',
          label: t('mobile.main_menu.dag', 'Sub-task tree'),
          onPress: () => go(ROUTES.Dag),
          disabled: !activeCrewId,
        },
      ],
    },
    {
      title: t('mobile.main_menu.section_app', 'App'),
      items: [
        {
          icon: 'options-outline',
          label: t('mobile.main_menu.settings', 'Settings'),
          onPress: () => go(ROUTES.Settings),
        },
        {
          icon: 'pulse-outline',
          label: t('mobile.main_menu.diagnostics', 'Diagnostics'),
          onPress: () => go(ROUTES.Metrics),
        },
        {
          icon: 'shield-checkmark-outline',
          label: t('mobile.main_menu.privacy', 'Privacy'),
          onPress: () => go(ROUTES.Privacy),
        },
        {
          icon: podSignedIn ? 'cloud-done-outline' : 'cloud-offline-outline',
          label: podSignedIn
            ? t('mobile.main_menu.pod_signed_in', 'Pod sign-in (signed in)')
            : t('mobile.main_menu.pod_sign_in', 'Sign in to Solid pod'),
          onPress: () => go(ROUTES.PodSignIn),
        },
        {
          // M1-S4 — pod & storage settings.
          icon: 'settings-outline',
          label: t('mobile.main_menu.pod_settings', 'Pod & storage settings'),
          onPress: () => go(ROUTES.PodSettings),
        },
      ],
    },
  ];

  return (
    <Modal transparent animationType="fade" visible onRequestClose={hide}>
      <Pressable
        onPress={hide}
        style={{ flex: 1, flexDirection: 'row', backgroundColor: COLORS.overlay }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation?.()}
          style={{
            width: '85%', maxWidth: 360, height: '100%',
            backgroundColor: COLORS.background,
            paddingTop: 48,
          }}
        >
          {/* Header — identity / crew summary */}
          <View style={{
            paddingHorizontal: SPACING.lg,
            paddingBottom: SPACING.lg,
            borderBottomWidth: 1, borderBottomColor: COLORS.border,
          }}>
            <Text style={{ fontSize: FONT_SIZES.lg, fontWeight: '600', color: COLORS.text }}>
              {svc?.identity?.handle ?? svc?.identity?.displayName ?? t('mobile.main_menu.signed_out_title', 'Tasks')}
            </Text>
            <Text style={{ fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: 2 }}>
              {activeCrew?.liveCrew?.name
                ? t('mobile.main_menu.in_crew', null).replace('{name}', activeCrew.liveCrew.name)
                : t('mobile.main_menu.no_active_crew', 'No active crew')}
            </Text>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: SPACING.xl }}>
            {sections.map((sec, idx) => (
              <View key={idx} style={{
                marginTop: SPACING.md,
              }}>
                <Text style={{
                  paddingHorizontal: SPACING.lg,
                  paddingVertical: SPACING.xs,
                  fontSize: FONT_SIZES.xs,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  color: COLORS.textMuted,
                  fontWeight: '600',
                }}>
                  {sec.title}
                </Text>
                {sec.items.map((it, jdx) => (
                  <Pressable
                    key={jdx}
                    onPress={it.disabled ? undefined : it.onPress}
                    disabled={!!it.disabled}
                    accessibilityRole="button"
                    accessibilityLabel={`main-menu-${it.label}`}
                    style={({ pressed }) => [
                      {
                        flexDirection: 'row', alignItems: 'center',
                        paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
                        opacity: it.disabled ? 0.45 : 1,
                      },
                      pressed && !it.disabled && { backgroundColor: COLORS.surfaceMuted },
                    ]}
                  >
                    <Ionicons
                      name={it.icon}
                      size={22}
                      color={COLORS.text}
                      style={{ marginRight: SPACING.md, width: 26 }}
                    />
                    <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md, flex: 1 }}>
                      {it.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}

            <View style={{ height: SPACING.xl }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

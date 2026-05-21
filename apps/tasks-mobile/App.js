/**
 * App.js — tasks-mobile root component.
 *
 * Phase 41.16 (2026-05-09): real-device polish — installed
 * unhandledRejection + global error handler + ErrorBoundary
 * (mirrors stoop-mobile's pattern), plus the deep-link handler
 * that consumes `tasks://...` URLs through the substrate's
 * parseDeepLink dispatcher (Phase 41.15.3).
 *
 * Provider tree: ThemeProvider → LocalisationProvider → ServiceProvider →
 * NavigationContainer (with DeepLinkHandler mounted INSIDE so
 * useNavigation works).
 */

import React from 'react';
import {
  Linking, ScrollView, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import {
  NavigationContainer, useNavigation,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator }   from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// ── Global error filtering — installed once at module-load. ──
// Mirrors apps/stoop-mobile/App.js + apps/tasks-v0/bin/tasks-ui.js.
// Catches the kind of background promise rejections that otherwise
// turn into RedBox crashes on a real device (e.g. transient
// network failures from the relay during foreground/background
// transitions).
if (typeof globalThis !== 'undefined') {
  const prev = globalThis.onunhandledrejection;
  globalThis.onunhandledrejection = (event) => {
    const err = event?.reason ?? event;
    console.error('[unhandledRejection]', err?.message ?? err);
    if (err?.stack) console.error('[unhandledRejection stack]', err.stack);
    prev?.(event);
  };
}
if (typeof globalThis.ErrorUtils?.setGlobalHandler === 'function') {
  const prev = globalThis.ErrorUtils.getGlobalHandler?.();
  globalThis.ErrorUtils.setGlobalHandler((err, isFatal) => {
    console.error('[globalError]', isFatal ? 'FATAL' : 'non-fatal', err?.message ?? err);
    if (err?.stack) console.error('[globalError stack]', err.stack);
    prev?.(err, isFatal);
  });
}

import { ThemeProvider } from '@canopy/react-native/theme';
import { ServiceProvider, useService } from './src/ServiceContext.js';
import { LocalisationProvider, useLocalisation } from './src/LocalisationProvider.js';
import { ROUTES } from './src/navigation.js';
import { parseDeepLink, actionToNavigation } from './src/lib/deepLinks.js';

import { WelcomeScreen }        from './src/screens/WelcomeScreen.jsx';
import { OnboardScanScreen }    from './src/screens/OnboardScanScreen.jsx';
import { OnboardRestoreScreen } from './src/screens/OnboardRestoreScreen.jsx';
import { OnboardIssueScreen }   from './src/screens/OnboardIssueScreen.jsx';
import { WorkspaceScreen }      from './src/screens/WorkspaceScreen.jsx';
import { TaskDetailScreen }     from './src/screens/TaskDetailScreen.jsx';
import { ComposeScreen }        from './src/screens/ComposeScreen.jsx';
import { MyWorkScreen }         from './src/screens/MyWorkScreen.jsx';
import { SubmitScreen }         from './src/screens/SubmitScreen.jsx';
import { ReviewScreen }         from './src/screens/ReviewScreen.jsx';
import { DagScreen }            from './src/screens/DagScreen.jsx';
import { InboxScreen }          from './src/screens/InboxScreen.jsx';
import { CrewsDashboardScreen } from './src/screens/CrewsDashboardScreen.jsx';
import { AvailabilityScreen }   from './src/screens/AvailabilityScreen.jsx';
import { ProfileMineScreen }    from './src/screens/ProfileMineScreen.jsx';
import { ProfileOtherScreen }   from './src/screens/ProfileOtherScreen.jsx';
import { SettingsScreen }       from './src/screens/SettingsScreen.jsx';
import { CrewSettingsScreen }   from './src/screens/CrewSettingsScreen.jsx';
import { IssueBotTokenScreen }  from './src/screens/IssueBotTokenScreen.jsx';
import { PodSignInScreen }      from './src/screens/PodSignInScreen.jsx';
import { AuthCallbackScreen }   from './src/screens/AuthCallbackScreen.jsx';
import { MetricsScreen }        from './src/screens/MetricsScreen.jsx';
import { PrivacyScreen }        from './src/screens/PrivacyScreen.jsx';
import { EditSkillsScreen }     from './src/screens/EditSkillsScreen.jsx';
import { CadenceOverridesScreen } from './src/screens/CadenceOverridesScreen.jsx';
import { ChatThreadScreen }     from './src/screens/ChatThreadScreen.jsx';
import { CreateCrewScreen }     from './src/screens/CreateCrewScreen.jsx';   // M1-S2
import { PodSettingsScreen }    from './src/screens/PodSettingsScreen.jsx';  // M1-S4
import { CrewSwitcher }         from './src/components/CrewSwitcher.jsx';
import { MainMenuProvider, MainMenuButton } from './src/components/MainMenu.jsx';
import { useInboxBadge }        from './src/lib/useInboxBadge.js';

const Stack = createNativeStackNavigator();
const Tabs  = createBottomTabNavigator();

// Phase 41.18 follow-up — bottom-tab shell over the five main
// destinations (Workspace / MyWork / Review / Inbox / Crews). The
// outer stack pushes detail + modal screens OVER the tab shell and
// hides the tab bar via `screenOptions`. Mirrors stoop-mobile's
// pattern (App.js's `ShellTabs`).
const TAB_ICONS = {
  Workspace: { active: 'home',         inactive: 'home-outline' },
  MyWork:    { active: 'list',         inactive: 'list-outline' },
  Review:    { active: 'checkmark-done', inactive: 'checkmark-done-outline' },
  Inbox:     { active: 'notifications', inactive: 'notifications-outline' },
  Crews:     { active: 'people',       inactive: 'people-outline' },
};

function _tabIcon(routeName) {
  return ({ focused, color, size }) => {
    const spec = TAB_ICONS[routeName] ?? { active: 'ellipse', inactive: 'ellipse-outline' };
    return <Ionicons
      name={focused ? spec.active : spec.inactive}
      size={size}
      color={color}
    />;
  };
}

/**
 * InboxTabIcon — small wrapper that surfaces the live badge count
 * on the Inbox tab via `navigation.setOptions`. The hook polls every
 * 30 s and refreshes on the agent's `inboxChanged` event.
 *
 * Note: `tabBarBadge` accepts a number or null; passing a falsy
 * value hides the badge.
 */
function InboxTabBadgeBinder() {
  const nav = useNavigation();
  const badge = useInboxBadge();
  React.useEffect(() => {
    nav.setOptions({
      tabBarBadge: badge.count > 0 ? badge.count : undefined,
    });
  }, [nav, badge.count]);
  return null;
}

/**
 * Tab-screen wrappers — needed because @react-navigation/bottom-tabs
 * doesn't pass the navigation prop to a non-screen component cleanly,
 * and we want the InboxTabBadgeBinder to share the screen tree.
 */
function InboxTabScreen() {
  return (
    <>
      <InboxTabBadgeBinder />
      <InboxScreen />
    </>
  );
}

function MainTabs() {
  // The MainMenuProvider wraps the tab navigator so any tab screen
  // (and any pushed detail) can call `useMainMenu().show()` to open
  // the drawer. The drawer itself renders inside the provider —
  // mounted once, regardless of which tab is active.
  return (
    <MainMenuProvider>
      <Tabs.Navigator
        screenOptions={({ route }) => ({
          headerShown:             true,
          headerLeft:              () => <MainMenuButton />,
          headerRight:             () => (
            <View style={{ paddingRight: 12 }}>
              <CrewSwitcher />
            </View>
          ),
          tabBarActiveTintColor:   TASKS_TOKENS.COLORS.primary,
          tabBarInactiveTintColor: '#6b7280',
          tabBarStyle:        { backgroundColor: '#fff', borderTopColor: '#e5e7eb' },
          tabBarLabelStyle:   { fontSize: 11 },
          tabBarIcon:         _tabIcon(route.name),
        })}
      >
        <Tabs.Screen name={ROUTES.Workspace} component={WorkspaceScreen}      options={{ title: 'Tasks' }} />
        <Tabs.Screen name={ROUTES.MyWork}    component={MyWorkScreen}         options={{ title: 'Mine' }} />
        <Tabs.Screen name={ROUTES.Review}    component={ReviewScreen}         options={{ title: 'Review' }} />
        <Tabs.Screen name={ROUTES.Inbox}     component={InboxTabScreen}       options={{ title: 'Inbox' }} />
        <Tabs.Screen name={ROUTES.Crews}     component={CrewsDashboardScreen} options={{ title: 'Crews' }} />
      </Tabs.Navigator>
    </MainMenuProvider>
  );
}

// Tasks-mobile palette — teal brand (overrides substrate
// DEFAULT_TOKENS only where it diverges).
const TASKS_TOKENS = {
  COLORS: {
    primary:      '#0d9488',
    primaryDark:  '#0f766e',
    primaryLight: '#99f6e4',
  },
};

/**
 * ErrorBoundary — last-line defence against a crashing component
 * tree on a real device. The screen-level error states
 * (BootGate.error, per-screen error props) handle the expected
 * cases; this catches anything that escapes those.
 */
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error?.message ?? error);
    if (info?.componentStack) console.error(info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView style={styles.errorRoot}>
        <Text style={styles.errorTitle}>Something went wrong.</Text>
        <Text style={styles.errorBody}>
          {String(this.state.error?.message ?? this.state.error)}
        </Text>
      </ScrollView>
    );
  }
}

/**
 * DeepLinkHandler — listens for `tasks://...` URLs, parses them via
 * `parseDeepLink`, and navigates accordingly. Mounted INSIDE the
 * NavigationContainer so `useNavigation()` works.
 */
function DeepLinkHandler() {
  const nav = useNavigation();

  React.useEffect(() => {
    let cancelled = false;

    const dispatch = (url) => {
      if (cancelled || typeof url !== 'string' || url.length === 0) return;
      const action = parseDeepLink(url);
      if (action.kind === 'unknown') {
        console.warn('[deepLink] unrecognised URL:', url);
        return;
      }
      const target = actionToNavigation(action);
      if (target) nav.navigate(target.name, target.params);
    };

    Linking.getInitialURL?.().then((url) => { if (url) dispatch(url); }).catch(() => { /* ignore */ });
    const sub = Linking.addEventListener?.('url', (event) => dispatch(event?.url));

    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, [nav]);

  return null;
}

function BootGate() {
  const svc = useService();
  const { t } = useLocalisation();

  if (!svc || svc.status === 'booting') {
    return (
      <View style={styles.center}>
        <Text style={styles.subtitle}>{t('mobile.boot.loading', 'Booting…')}</Text>
      </View>
    );
  }

  if (svc.status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{t('mobile.boot.error', 'Couldn’t start')}</Text>
        <Text style={styles.hint}>{String(svc.error?.message ?? svc.error ?? '')}</Text>
      </View>
    );
  }

  // Once a crew exists, the user lands inside the bottom-tab shell
  // (Main). Otherwise we boot into the Welcome onboarding stack.
  const initialRoute = svc.crews.size > 0 ? ROUTES.Main : ROUTES.Welcome;

  return (
    <NavigationContainer>
      <DeepLinkHandler />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name={ROUTES.Welcome}        component={WelcomeScreen} />
        <Stack.Screen name={ROUTES.OnboardScan}    component={OnboardScanScreen} />
        <Stack.Screen name={ROUTES.OnboardRestore} component={OnboardRestoreScreen} />
        <Stack.Screen name={ROUTES.OnboardIssue}   component={OnboardIssueScreen} />
        {/* Main = the bottom-tab shell (Workspace + MyWork + Review +
            Inbox + Crews). Detail / modal routes push OVER this. */}
        <Stack.Screen name={ROUTES.Main}           component={MainTabs} />
        <Stack.Screen name={ROUTES.TaskDetail}     component={TaskDetailScreen}
                      options={{ headerShown: true, title: '' }} />
        <Stack.Screen name={ROUTES.Compose}        component={ComposeScreen}
                      options={{ presentation: 'modal' }} />
        <Stack.Screen name={ROUTES.Submit}         component={SubmitScreen}
                      options={{ headerShown: true, title: 'Submit' }} />
        <Stack.Screen name={ROUTES.Dag}            component={DagScreen}
                      options={{ headerShown: true, title: 'Sub-tasks' }} />
        <Stack.Screen name={ROUTES.Availability}   component={AvailabilityScreen}
                      options={{ headerShown: true, title: 'Availability' }} />
        <Stack.Screen name={ROUTES.ProfileMine}    component={ProfileMineScreen}
                      options={{ headerShown: true, title: 'Profile' }} />
        <Stack.Screen name={ROUTES.ProfileOther}   component={ProfileOtherScreen}
                      options={{ headerShown: true, title: 'Profile' }} />
        <Stack.Screen name={ROUTES.Settings}       component={SettingsScreen}
                      options={{ headerShown: true, title: 'Settings' }} />
        <Stack.Screen name={ROUTES.CrewSettings}   component={CrewSettingsScreen}
                      options={{ headerShown: true, title: 'Crew settings' }} />
        <Stack.Screen name={ROUTES.IssueBotToken}  component={IssueBotTokenScreen}
                      options={{ headerShown: true, title: 'Bot token QR' }} />
        <Stack.Screen name={ROUTES.PodSignIn}      component={PodSignInScreen}
                      options={{ headerShown: true, title: 'Sign in' }} />
        <Stack.Screen name={ROUTES.AuthCallback}   component={AuthCallbackScreen}
                      options={{ headerShown: false }} />
        <Stack.Screen name={ROUTES.Metrics}        component={MetricsScreen}
                      options={{ headerShown: true, title: 'Diagnostics' }} />
        <Stack.Screen name={ROUTES.Privacy}        component={PrivacyScreen}
                      options={{ headerShown: true, title: 'Privacy' }} />
        <Stack.Screen name={ROUTES.EditSkills}     component={EditSkillsScreen}
                      options={{ headerShown: true, title: 'Edit my skills' }} />
        <Stack.Screen name={ROUTES.CadenceOverrides} component={CadenceOverridesScreen}
                      options={{ headerShown: true, title: 'Cadence overrides' }} />
        <Stack.Screen name={ROUTES.ChatThread}     component={ChatThreadScreen}
                      options={{ headerShown: true, title: 'Chat' }} />
        {/* M1-S2 — full wizard with storage-policy picker */}
        <Stack.Screen name={ROUTES.CreateCrew}    component={CreateCrewScreen}
                      options={{ presentation: 'modal', headerShown: true, title: 'New crew' }} />
        {/* M1-S4 — pod & storage settings */}
        <Stack.Screen name={ROUTES.PodSettings}   component={PodSettingsScreen}
                      options={{ headerShown: true, title: 'Pod & storage' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App({ boot } = {}) {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" />
        <ThemeProvider value={TASKS_TOKENS}>
          <LocalisationProvider>
            <ServiceProvider boot={boot}>
              <BootGate />
            </ServiceProvider>
          </LocalisationProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6b7280',
    marginBottom: 24,
    fontFamily: 'monospace',
  },
  hint: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    maxWidth: 320,
  },
  errorRoot: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#b91c1c',
    marginBottom: 12,
  },
  errorBody: {
    fontSize: 14,
    color: '#374151',
    fontFamily: 'monospace',
  },
});

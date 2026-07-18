/**
 * App.js — stoop-mobile root component.
 *
 * Phase 40.10 (V3 mobile, 2026-05-08): full route table wired into a
 * react-navigation native-stack. Most screens still render the
 * `PlaceholderScreen` until their dedicated screen file is shipped
 * — see `src/screens/<Name>Screen.js`. The route table itself lives
 * in `src/navigation.js` (single source of truth shared with the
 * future deep-link handler in Phase 40.11).
 */

import React from 'react';
import { ScrollView, StatusBar, StyleSheet, Text } from 'react-native';

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

import { Linking }                    from 'react-native';
import {
  NavigationContainer,
  useNavigation,
}                                     from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator }   from '@react-navigation/bottom-tabs';
import { SafeAreaProvider }           from 'react-native-safe-area-context';
import { Ionicons }                   from '@expo/vector-icons';

import { parseDeepLink, actionToNavigation } from './src/lib/deepLinks.js';

import { ROUTES, SHELL_TAB_ROUTES, STACK_ONLY_ROUTES } from './src/navigation.js';
import { t, initLocalisation }                from './src/lib/localisation.js';
import { COLORS, SPACING, RADII, FONT_SIZES } from './src/lib/theme.js';
import { ThemeProvider }              from '@onderling/react-native/theme';

const STOOP_TOKENS = { COLORS, SPACING, RADII, FONT_SIZES };
import { ServiceProvider }            from './src/ServiceContext.js';
import { hasSeenMetadataWarning }     from './src/lib/metadataWarning.js';

// PlaceholderScreen is unused now that every route has a real screen,
// but we keep the import path stable for future regression scaffolds.
// eslint-disable-next-line no-unused-vars
import { PlaceholderScreen as _PlaceholderScreen } from './src/screens/PlaceholderScreen.js';
import { WelcomeScreen }              from './src/screens/WelcomeScreen.js';
import { OnboardScanScreen }          from './src/screens/OnboardScanScreen.js';
import { OnboardRestoreScreen }       from './src/screens/OnboardRestoreScreen.js';
import { ProfileMineScreen }          from './src/screens/ProfileMineScreen.js';
import { ProfileOtherScreen }         from './src/screens/ProfileOtherScreen.js';
import { FeedScreen }                 from './src/screens/FeedScreen.js';
import { PostComposeScreen }          from './src/screens/PostComposeScreen.js';
import { ItemDetailScreen }           from './src/screens/ItemDetailScreen.js';
import { ChatThreadsScreen }          from './src/screens/ChatThreadsScreen.js';
import { ChatThreadScreen }           from './src/screens/ChatThreadScreen.js';
import { ContactsScreen }             from './src/screens/ContactsScreen.js';
import { ContactScreen }              from './src/screens/ContactScreen.js';
import { GroupScreen }                from './src/screens/GroupScreen.js';
import { SettingsScreen }             from './src/screens/SettingsScreen.js';
import { PrivacyScreen }              from './src/screens/PrivacyScreen.js';
import { PushScreen }                 from './src/screens/PushScreen.js';
import { SignInScreen }               from './src/screens/SignInScreen.js';
import { OnboardIssueScreen }         from './src/screens/OnboardIssueScreen.js';
import { CreateGroupScreen }          from './src/screens/CreateGroupScreen.js';
import { OnboardJoinScreen }          from './src/screens/OnboardJoinScreen.js';
import { AuthCallbackScreen }         from './src/screens/AuthCallbackScreen.js';
import { OfferingMatchInboxScreen }      from './src/screens/OfferingMatchInboxScreen.js';
import { MetadataWarningScreen }      from './src/screens/MetadataWarningScreen.js';
import { MineScreen }                 from './src/screens/MineScreen.js';
import { MetricsScreen }              from './src/screens/MetricsScreen.js';

// Route → screen component map.  Tests introspect this without
// rendering, so it has to cover every route that's reachable in the
// app (including the synthetic `Shell` route).
export const SCREEN_COMPONENTS = Object.freeze({
  // Stack-only routes
  [ROUTES.MetadataWarning]: MetadataWarningScreen,
  [ROUTES.Welcome]:        WelcomeScreen,
  [ROUTES.OnboardScan]:    OnboardScanScreen,
  [ROUTES.OnboardRestore]: OnboardRestoreScreen,
  [ROUTES.OnboardIssue]:   OnboardIssueScreen,
  [ROUTES.SignIn]:         SignInScreen,
  [ROUTES.CreateGroup]:    CreateGroupScreen,
  [ROUTES.OnboardJoin]:    OnboardJoinScreen,
  [ROUTES.AuthCallback]:   AuthCallbackScreen,
  [ROUTES.OfferingMatchInbox]:OfferingMatchInboxScreen,
  [ROUTES.PostCompose]:    PostComposeScreen,
  [ROUTES.ItemDetail]:     ItemDetailScreen,
  [ROUTES.ChatThread]:     ChatThreadScreen,
  [ROUTES.ProfileOther]:   ProfileOtherScreen,
  [ROUTES.Contact]:        ContactScreen,
  [ROUTES.Group]:          GroupScreen,
  [ROUTES.Privacy]:        PrivacyScreen,
  [ROUTES.Push]:           PushScreen,
  [ROUTES.Metrics]:        MetricsScreen,

  // Shell tab routes
  [ROUTES.Feed]:           FeedScreen,
  [ROUTES.Mine]:           MineScreen,
  [ROUTES.ChatThreads]:    ChatThreadsScreen,
  [ROUTES.Contacts]:       ContactsScreen,
  [ROUTES.ProfileMine]:    ProfileMineScreen,
  [ROUTES.Settings]:       SettingsScreen,

  // Synthetic — wraps the tabs.  Defined below.
  [ROUTES.Shell]:          ShellTabs,
});

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

const Stack = createNativeStackNavigator();
const Tabs  = createBottomTabNavigator();

/**
 * ShellTabs — the bottom-tab shell containing the user's main
 * destinations: Feed / Mine / Chat / Contacts / Profile / Settings.
 * Detail routes (ItemDetail / ChatThread / Contact / Group / etc.)
 * push OVER this shell from the outer stack and hide the tab bar.
 *
 * Function declaration so it can be referenced from `SCREEN_COMPONENTS`
 * before the textual definition (function declarations are hoisted).
 */
// Tab → Ionicon name (filled when focused, outline otherwise).
// Ionicons is bundled with Expo; no separate install needed.
const TAB_ICONS = {
  [ROUTES.Feed]:        { active: 'home',        inactive: 'home-outline' },
  [ROUTES.Mine]:        { active: 'list',        inactive: 'list-outline' },
  [ROUTES.ChatThreads]: { active: 'chatbubbles', inactive: 'chatbubbles-outline' },
  [ROUTES.Contacts]:    { active: 'people',      inactive: 'people-outline' },
  [ROUTES.ProfileMine]: { active: 'person',      inactive: 'person-outline' },
  [ROUTES.Settings]:    { active: 'settings',    inactive: 'settings-outline' },
};

function _tabIcon(routeName) {
  return ({ focused, color, size }) => {
    const spec = TAB_ICONS[routeName];
    const name = spec ? (focused ? spec.active : spec.inactive) : 'ellipse-outline';
    return <Ionicons name={name} size={size} color={color} />;
  };
}

function ShellTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown:             true,
        tabBarActiveTintColor:   COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
        tabBarStyle:        { backgroundColor: COLORS.surface, borderTopColor: COLORS.border },
        tabBarLabelStyle:   { fontSize: 11 },
        tabBarIcon:         _tabIcon(route.name),
      })}
    >
      <Tabs.Screen name={ROUTES.Feed}        component={FeedScreen}        options={{ title: t('tabs.feed',     'Feed') }} />
      <Tabs.Screen name={ROUTES.Mine}        component={MineScreen}        options={{ title: t('tabs.mine',     'Mine') }} />
      <Tabs.Screen name={ROUTES.ChatThreads} component={ChatThreadsScreen} options={{ title: t('tabs.chat',     'Chat') }} />
      <Tabs.Screen name={ROUTES.Contacts}    component={ContactsScreen}    options={{ title: t('tabs.contacts', 'Contacts') }} />
      <Tabs.Screen name={ROUTES.ProfileMine} component={ProfileMineScreen} options={{ title: t('tabs.profile',  'Profile') }} />
      <Tabs.Screen name={ROUTES.Settings}    component={SettingsScreen}    options={{ title: t('tabs.settings', 'Settings') }} />
    </Tabs.Navigator>
  );
}

/**
 * DeepLinkHandler — listens for `stoop://...` URLs, parses them via
 * `parseDeepLink`, and navigates accordingly.
 *
 * Mounted INSIDE the NavigationContainer so `useNavigation()` works.
 * Pulls the cold-start URL via `Linking.getInitialURL()` once, then
 * subscribes to subsequent `'url'` events for the warm path.
 *
 * Renders nothing.
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

// Kick off localisation once at module-load.  No `lng` → auto-detect from
// the device locale (Dutch → 'nl', everything else → 'en').
// Settings can swap it later.
initLocalisation().catch((err) => {
  console.warn('[localisation] init failed (falling back to keys):', err?.message ?? err);
});

export default function App() {
  // Phase 40.22: gate the initial route on whether the user has
  // acknowledged the metadata-public privacy warning.  First launch
  // → MetadataWarning; subsequent launches → Welcome.
  const [initialRoute, setInitialRoute] = React.useState(null);
  React.useEffect(() => {
    hasSeenMetadataWarning()
      .then((seen) => setInitialRoute(seen ? ROUTES.Welcome : ROUTES.MetadataWarning))
      .catch(() => setInitialRoute(ROUTES.Welcome));
  }, []);
  if (initialRoute == null) return null; // brief splash; AsyncStorage round-trip is ~ms

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider value={STOOP_TOKENS}>
        <StatusBar barStyle="default" />
        <ServiceProvider>
        <NavigationContainer>
          <DeepLinkHandler />
          <Stack.Navigator
            initialRouteName={initialRoute}
            screenOptions={{ headerShown: false }}
          >
            {/* Entry stack — pre-shell screens. */}
            <Stack.Screen name={ROUTES.MetadataWarning} component={MetadataWarningScreen} />
            <Stack.Screen name={ROUTES.Welcome}        component={WelcomeScreen} />
            <Stack.Screen name={ROUTES.OnboardScan}    component={OnboardScanScreen} />
            <Stack.Screen name={ROUTES.OnboardRestore} component={OnboardRestoreScreen} />
            <Stack.Screen name={ROUTES.OnboardIssue}   component={OnboardIssueScreen} />
            <Stack.Screen name={ROUTES.SignIn}         component={SignInScreen} />
            <Stack.Screen name={ROUTES.CreateGroup}    component={CreateGroupScreen} />
            <Stack.Screen name={ROUTES.OnboardJoin}    component={OnboardJoinScreen} />
            <Stack.Screen name={ROUTES.AuthCallback}   component={AuthCallbackScreen} />
            <Stack.Screen name={ROUTES.OfferingMatchInbox} component={OfferingMatchInboxScreen} />

            {/* The shell — bottom-tabs.  Welcome's "Beginnen" CTA
                navigates here; deep links drop straight into a tab. */}
            <Stack.Screen name={ROUTES.Shell}          component={ShellTabs} />

            {/* Detail screens — pushed over the shell, hide the tab
                bar (native-stack hides the parent tab bar by default
                because it covers the whole screen). */}
            <Stack.Screen name={ROUTES.PostCompose}    component={PostComposeScreen} />
            <Stack.Screen name={ROUTES.ItemDetail}     component={ItemDetailScreen} />
            <Stack.Screen name={ROUTES.ChatThread}     component={ChatThreadScreen} />
            <Stack.Screen name={ROUTES.ProfileOther}   component={ProfileOtherScreen} />
            <Stack.Screen name={ROUTES.Contact}        component={ContactScreen} />
            <Stack.Screen name={ROUTES.Group}          component={GroupScreen} />
            <Stack.Screen name={ROUTES.Privacy}        component={PrivacyScreen} />
            <Stack.Screen name={ROUTES.Push}           component={PushScreen} />
            <Stack.Screen name={ROUTES.Metrics}        component={MetricsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
        </ServiceProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  errorRoot:  { flex: 1, padding: 24, backgroundColor: '#fee' },
  errorTitle: { fontSize: 22, fontWeight: '600', marginBottom: 8 },
  errorBody:  { fontFamily: 'monospace', fontSize: 14 },
});

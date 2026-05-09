/**
 * App.js — tasks-mobile root component.
 *
 * Phase 41.16 (2026-05-09): real-device polish — installed
 * unhandledRejection + global error handler + ErrorBoundary
 * (mirrors stoop-mobile's pattern), plus the deep-link handler
 * that consumes `tasks://...` URLs through the substrate's
 * parseDeepLink dispatcher (Phase 41.15.3).
 *
 * Provider tree: ThemeProvider → I18nProvider → ServiceProvider →
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
import { SafeAreaProvider } from 'react-native-safe-area-context';

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
import { I18nProvider, useI18n } from './src/I18nProvider.js';
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

const Stack = createNativeStackNavigator();

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
  const { t } = useI18n();

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

  const initialRoute = svc.crews.size > 0 ? ROUTES.Workspace : ROUTES.Welcome;

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
        <Stack.Screen name={ROUTES.Workspace}      component={WorkspaceScreen}
                      options={{ headerShown: true, title: 'Tasks' }} />
        <Stack.Screen name={ROUTES.TaskDetail}     component={TaskDetailScreen}
                      options={{ headerShown: true, title: '' }} />
        <Stack.Screen name={ROUTES.Compose}        component={ComposeScreen}
                      options={{ presentation: 'modal' }} />
        <Stack.Screen name={ROUTES.MyWork}         component={MyWorkScreen}
                      options={{ headerShown: true, title: 'My work' }} />
        <Stack.Screen name={ROUTES.Submit}         component={SubmitScreen}
                      options={{ headerShown: true, title: 'Submit' }} />
        <Stack.Screen name={ROUTES.Review}         component={ReviewScreen}
                      options={{ headerShown: true, title: 'Review' }} />
        <Stack.Screen name={ROUTES.Dag}            component={DagScreen}
                      options={{ headerShown: true, title: 'Sub-tasks' }} />
        <Stack.Screen name={ROUTES.Inbox}          component={InboxScreen}
                      options={{ headerShown: true, title: 'Inbox' }} />
        <Stack.Screen name={ROUTES.Crews}          component={CrewsDashboardScreen}
                      options={{ headerShown: true, title: 'Crews' }} />
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
          <I18nProvider>
            <ServiceProvider boot={boot}>
              <BootGate />
            </ServiceProvider>
          </I18nProvider>
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

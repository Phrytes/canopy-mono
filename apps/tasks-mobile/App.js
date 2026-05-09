/**
 * App.js — tasks-mobile root component.
 *
 * Phase 41.3 (2026-05-09): wires the onboarding stack into the
 * navigator. Initial route depends on boot state — Welcome when the
 * user has no crews yet, Workspace (placeholder for 41.4) when they
 * have at least one. The booting / error states render a small splash
 * directly, BEFORE the navigator mounts (so we don't show the route
 * table mid-bootstrap).
 *
 * Provider tree: ThemeProvider → I18nProvider → ServiceProvider →
 * NavigationContainer.
 */

import React from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '@canopy/react-native/theme';
import { ServiceProvider, useService } from './src/ServiceContext.js';
import { I18nProvider, useI18n } from './src/I18nProvider.js';
import { ROUTES } from './src/navigation.js';

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
});

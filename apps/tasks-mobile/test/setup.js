/**
 * test/setup.js — Vitest global setup for tasks-mobile.
 *
 * vitest runs in node, not a real RN runtime, so we stub the Expo
 * modules our screens + lib code import. Mirrors the
 * apps/stoop-mobile/test/setup.js shape; per-test files overload via
 * vi.mock() when they need richer mocks.
 *
 * No test file should reach for a real device / real network.
 */

import { vi } from 'vitest';

// React Native — only the surfaces our pure-JS lib code touches in node.
vi.mock('react-native', () => {
  const Platform = { OS: 'android', select: (obj) => obj.android ?? obj.default };
  return {
    Platform,
    StyleSheet: { create: (s) => s, hairlineWidth: 1, flatten: (s) => s },
    Alert:       { alert: vi.fn() },
    Linking: {
      openURL:          vi.fn(),
      getInitialURL:    vi.fn(async () => null),
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    },
    AppState: {
      currentState: 'active',
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    },
    // Component stubs — the tests mostly poke at logic, not rendered output.
    View:                 'View',
    Text:                 'Text',
    Pressable:            'Pressable',
    TextInput:            'TextInput',
    ScrollView:           'ScrollView',
    FlatList:             'FlatList',
    SafeAreaView:         'SafeAreaView',
    StatusBar:            'StatusBar',
    ActivityIndicator:    'ActivityIndicator',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
  };
});

// React Navigation — used by App.js's NavigationContainer.
vi.mock('@react-navigation/native', () => ({
  useNavigation: vi.fn(() => ({ navigate: vi.fn(), goBack: vi.fn(), setOptions: vi.fn() })),
  useRoute:      vi.fn(() => ({ params: {} })),
  NavigationContainer: ({ children }) => children,
}));

vi.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }) => children,
    Screen:    ({ children }) => children,
  }),
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }) => children,
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

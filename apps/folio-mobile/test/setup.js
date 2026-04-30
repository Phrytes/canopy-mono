/**
 * test/setup.js — Vitest global setup for folio-mobile.
 *
 * vitest runs in node, not in a real RN runtime, so we install thin
 * stubs for the Expo modules our screens / auth / context import.  Each
 * test that wants behavioural coverage replaces the stub with a richer
 * mock via vi.mock() (see test/auth.test.js).
 *
 * No test file should reach for a real device / real network.
 */

import { vi } from 'vitest';

// React Native — only the surfaces our pure-JS lib code touches in node:
// mostly module imports we never invoke under test.  We stub the parts
// that DO get imported so tests can exercise our adapter / lib code
// without pulling in the RN runtime.
vi.mock('react-native', () => {
  const Platform = { OS: 'ios', select: (obj) => obj.ios ?? obj.default };
  return {
    Platform,
    StyleSheet: { create: (s) => s, hairlineWidth: 1, flatten: (s) => s },
    Alert:       { alert: vi.fn() },
    Linking:     { openURL: vi.fn() },
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

// Expo modules — minimal stubs.  Tests overload these per-suite.
vi.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    getItemAsync:    vi.fn(async (k) => store.get(k) ?? null),
    setItemAsync:    vi.fn(async (k, v) => { store.set(k, v); }),
    deleteItemAsync: vi.fn(async (k) => { store.delete(k); }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    __resetForTest: () => store.clear(),
  };
});

vi.mock('expo-auth-session', () => ({
  // useAuthRequest returns [request, response, promptAsync].
  useAuthRequest:   vi.fn(() => [null, null, vi.fn()]),
  exchangeCodeAsync: vi.fn(async () => ({
    accessToken:  'mock-access',
    refreshToken: 'mock-refresh',
    idToken:      'mock-id',
    expiresIn:    3600,
  })),
  AuthRequest:     class { async promptAsync() { return { type: 'success', params: { code: 'mock-code' } }; } },
  ResponseType:    { Code: 'code' },
  CodeChallengeMethod: { S256: 'S256' },
  makeRedirectUri: vi.fn(({ scheme = 'folio', path = 'auth/callback' } = {}) => `${scheme}://${path}`),
  fetchDiscoveryAsync: vi.fn(async () => ({
    authorizationEndpoint: 'https://login.inrupt.com/authorize',
    tokenEndpoint:         'https://login.inrupt.com/token',
    revocationEndpoint:    'https://login.inrupt.com/revoke',
    discoveryDocument:     {},
  })),
}));

vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: vi.fn(async () => ({ type: 'success', url: 'folio://auth/callback?code=mock-code' })),
  maybeCompleteAuthSession: vi.fn(),
  WebBrowserResultType: { SUCCESS: 'success', CANCEL: 'cancel', DISMISS: 'dismiss' },
}));

vi.mock('expo-file-system', () => ({
  documentDirectory: 'file:///doc/',
  cacheDirectory:    'file:///cache/',
  EncodingType:      { UTF8: 'utf8', Base64: 'base64' },
  readAsStringAsync:  vi.fn(async () => ''),
  writeAsStringAsync: vi.fn(async () => {}),
  makeDirectoryAsync: vi.fn(async () => {}),
  readDirectoryAsync: vi.fn(async () => []),
  getInfoAsync:       vi.fn(async () => ({ exists: false })),
  deleteAsync:        vi.fn(async () => {}),
  moveAsync:          vi.fn(async () => {}),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding:        { HEX: 'hex', BASE64: 'base64' },
  digestStringAsync:     vi.fn(async () => '0'.repeat(64)),
}));

vi.mock('expo-task-manager', () => ({
  defineTask:   vi.fn(),
  isTaskDefined: vi.fn(() => false),
}));

vi.mock('expo-background-fetch', () => ({
  registerTaskAsync:   vi.fn(async () => {}),
  unregisterTaskAsync: vi.fn(async () => {}),
  getStatusAsync:      vi.fn(async () => 3),
  BackgroundFetchResult: { NoData: 1, NewData: 2, Failed: 3 },
}));

vi.mock('expo-status-bar', () => ({
  StatusBar: 'StatusBar',
}));

// React-navigation: our screens import `useNavigation()` etc.  Stub.
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
  SafeAreaView:     'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    default: {
      getItem:   vi.fn(async (k) => store.get(k) ?? null),
      setItem:   vi.fn(async (k, v) => { store.set(k, v); }),
      removeItem: vi.fn(async (k) => { store.delete(k); }),
      getAllKeys: vi.fn(async () => [...store.keys()]),
      multiRemove: vi.fn(async (keys) => { for (const k of keys) store.delete(k); }),
      clear:      vi.fn(async () => { store.clear(); }),
    },
  };
});

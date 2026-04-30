// Crypto polyfill MUST be the first import — @noble/hashes (transitively
// pulled in by @scure/bip39 via @canopy/core's Mnemonic) looks up
// globalThis.crypto at module-load time.  On React Native that global
// doesn't exist by default; react-native-get-random-values installs it
// synchronously.  Without this line the bundle crashes on startup with
// "property 'require' doesn't exist" as soon as Hermes tries to resolve
// the missing crypto object.
import 'react-native-get-random-values';
import 'expo-dev-client';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);

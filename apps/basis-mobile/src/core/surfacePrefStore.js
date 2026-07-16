/**
 * surfacePrefStore — S6.C (mobile): the per-user surface preference singleton,
 * shared by the kring screen (applies it to bot replies) + the My-data screen
 * (sets it). Mirrors web's module-level store in circleApp.js, backed by
 * AsyncStorage. Hydrated on import (best-effort); reads are synchronous + cached.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSurfacePrefStore, asyncStorageSurfacePrefIo } from '../../../basis/src/v2/surfacePref.js';

export const surfacePrefStore = createSurfacePrefStore(asyncStorageSurfacePrefIo(AsyncStorage));

// Load the saved preference once at startup; until it resolves `.get()` returns
// the default ('inline'), matching web.
surfacePrefStore.hydrate().catch(() => {});

/**
 * @canopy/react-native/picker — image-picker substrate.
 *
 * Apps consume `pickAndResize({mode, preset, max})` with a preset of
 * their choice (size + quality knobs). Stoop's PRIKBORD/CHAT/AVATAR
 * presets stay in apps/stoop-mobile/src/lib/imagePicker.js (which now
 * re-exports through this submodule). Generic `DELIVERABLE_PRESET` +
 * `AVATAR_PRESET` live here for apps that don't need a custom shape.
 */

export {
  pickAndResize,
  captureWithCamera,
  pickFromLibrary,
} from './pickAndResize.js';

export {
  DELIVERABLE_PRESET,
  AVATAR_PRESET,
} from './presets.js';

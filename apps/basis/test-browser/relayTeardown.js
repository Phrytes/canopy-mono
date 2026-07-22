/**
 * relayTeardown.js — default-export wrapper so playwright.config's `globalTeardown`
 * (which resolves a module's DEFAULT export) can stop the relay started by relayFixture.js.
 */
export { globalTeardown as default } from './relayFixture.js';

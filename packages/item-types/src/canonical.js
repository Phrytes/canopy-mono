/**
 * The canonical type set that ships with `@canopy/item-types`.
 *
 * Apps that want to add bespoke types call `registerType(...)`
 * on the same registry (or a fresh one via `createRegistry()`).
 */

import { TASK_SCHEMA }              from './types/task.js';
import { NOTE_SCHEMA }              from './types/note.js';
import { CHAT_MESSAGE_SCHEMA }      from './types/chat-message.js';
import { OFFER_SCHEMA }             from './types/offer.js';
import { REQUEST_SCHEMA }           from './types/request.js';
import { CLAIM_SCHEMA }             from './types/claim.js';
import { CONTACT_SCHEMA }           from './types/contact.js';
import { CALENDAR_EVENT_SCHEMA }    from './types/calendar-event.js';
import { ANNOUNCEMENT_SCHEMA }      from './types/announcement.js';
import { REVEAL_REQUEST_SCHEMA }    from './types/reveal-request.js';
import { NEIGHBOURHOOD_JOB_SCHEMA } from './types/neighbourhood-job.js';

/**
 * Map of canonical name → schema. Useful for `Object.entries(...)`
 * iteration when building a fresh registry.
 *
 * Vocabulary refresh 2026-05-12: `offer` + `request` + `claim`
 * replace the legacy `supply-offer` / `demand-offer` / `lend-request`
 * trio. Old names persist as **aliases** (see `LEGACY_ALIASES` below)
 * so already-written data + apps in transition keep validating.
 */
export const CANONICAL_TYPES = Object.freeze({
  'task':               TASK_SCHEMA,
  'note':               NOTE_SCHEMA,
  'chat-message':       CHAT_MESSAGE_SCHEMA,
  'offer':              OFFER_SCHEMA,
  'request':            REQUEST_SCHEMA,
  'claim':              CLAIM_SCHEMA,
  'contact':            CONTACT_SCHEMA,
  'calendar-event':     CALENDAR_EVENT_SCHEMA,
  'announcement':       ANNOUNCEMENT_SCHEMA,
  'reveal-request':     REVEAL_REQUEST_SCHEMA,
  'neighbourhood-job':  NEIGHBOURHOOD_JOB_SCHEMA,
});

/**
 * Legacy-name → canonical-name aliases for the 2026-05-12 vocabulary
 * refresh. The registry resolves these transparently — `validate({type:
 * 'supply-offer'})` routes to the `offer` schema. Adopters can drop
 * the legacy names on their own schedule.
 */
export const LEGACY_ALIASES = Object.freeze({
  'offer':    ['supply-offer'],
  'request':  ['demand-offer'],
  'claim':    ['lend-request'],
});

/**
 * Register every canonical type on the supplied registry, including
 * the legacy-name aliases.
 *
 * @param {ReturnType<typeof import('./registry.js').createRegistry>} registry
 */
export function registerCanonicalTypes(registry) {
  for (const [name, schema] of Object.entries(CANONICAL_TYPES)) {
    const aliases = LEGACY_ALIASES[name];
    registry.registerType(name, schema, aliases ? { aliases } : undefined);
  }
}

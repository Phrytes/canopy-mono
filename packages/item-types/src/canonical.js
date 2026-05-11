/**
 * The canonical type set that ships with `@canopy/item-types`.
 *
 * Apps that want to add bespoke types call `registerType(...)`
 * on the same registry (or a fresh one via `createRegistry()`).
 */

import { TASK_SCHEMA }              from './types/task.js';
import { NOTE_SCHEMA }              from './types/note.js';
import { CHAT_MESSAGE_SCHEMA }      from './types/chat-message.js';
import { SUPPLY_OFFER_SCHEMA }      from './types/supply-offer.js';
import { DEMAND_OFFER_SCHEMA }      from './types/demand-offer.js';
import { LEND_REQUEST_SCHEMA }      from './types/lend-request.js';
import { CONTACT_SCHEMA }           from './types/contact.js';
import { CALENDAR_EVENT_SCHEMA }    from './types/calendar-event.js';
import { ANNOUNCEMENT_SCHEMA }      from './types/announcement.js';
import { REVEAL_REQUEST_SCHEMA }    from './types/reveal-request.js';
import { NEIGHBOURHOOD_JOB_SCHEMA } from './types/neighbourhood-job.js';

/**
 * Map of canonical name → schema. Useful for `Object.entries(...)`
 * iteration when building a fresh registry.
 */
export const CANONICAL_TYPES = Object.freeze({
  'task':               TASK_SCHEMA,
  'note':               NOTE_SCHEMA,
  'chat-message':       CHAT_MESSAGE_SCHEMA,
  'supply-offer':       SUPPLY_OFFER_SCHEMA,
  'demand-offer':       DEMAND_OFFER_SCHEMA,
  'lend-request':       LEND_REQUEST_SCHEMA,
  'contact':            CONTACT_SCHEMA,
  'calendar-event':     CALENDAR_EVENT_SCHEMA,
  'announcement':       ANNOUNCEMENT_SCHEMA,
  'reveal-request':     REVEAL_REQUEST_SCHEMA,
  'neighbourhood-job':  NEIGHBOURHOOD_JOB_SCHEMA,
});

/**
 * Register every canonical type on the supplied registry.
 *
 * @param {ReturnType<typeof import('./registry.js').createRegistry>} registry
 */
export function registerCanonicalTypes(registry) {
  for (const [name, schema] of Object.entries(CANONICAL_TYPES)) {
    registry.registerType(name, schema);
  }
}

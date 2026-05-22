/**
 * @canopy-app/calendar — CalendarStore.
 *
 * v0.7.10 implementation note (2026-05-23): originally scoped to
 * compose `@canopy/item-store/ItemStore` over `@canopy/pseudo-pod`.
 * In practice ItemStore.#materialise whitelists only the canonical
 * task/post/claim fields it knows about — calendar-event's custom
 * fields (`startsAt`, `endsAt`, `attendees`, `rsvp`, `location`)
 * get stripped on persist.  The architectural mismatch: ItemStore
 * is for items with the household/tasks/stoop shape, not arbitrary
 * typed items.
 *
 * For v0.7.10 we use `@canopy/pseudo-pod` DIRECTLY: each event is
 * a JSON record at `pseudo-pod://<deviceId>/calendar/events/<id>.json`.
 * Same Solid-shape API; same forward-compat with the v0.7.11 pod
 * swap.  Audit + role-policy + per-field-merge that ItemStore would
 * have provided land later via either:
 *   (a) extending ItemStore's #materialise to honour per-type
 *       allow-lists OR
 *   (b) keeping pseudo-pod direct + adding audit + role layers in
 *       calendar-app-specific code (simpler if calendar's needs
 *       diverge from tasks/household).
 *
 * Substrate-reuse gate noted this gap; v0.7.11 design call.
 *
 * Item shape:
 *   {
 *     id, type: 'calendar-event', title, startsAt, endsAt,
 *     location?, attendees: [webid...], organiser,
 *     rsvp: { '<webid>': 'accepted' | 'declined' | 'tentative' },
 *     state: 'open' | 'cancelled',
 *     addedAt, addedBy,
 *     cancelledAt?, cancelledBy?,
 *   }
 */

import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';

const TYPE      = 'calendar-event';
const DEVICE_ID = 'calendar-demo';
const ROOT      = `pseudo-pod://${DEVICE_ID}/calendar/events/`;

/**
 * @typedef {object} CalendarEvent
 * @property {string}        id
 * @property {'calendar-event'} type
 * @property {string}        title
 * @property {string}        startsAt           ISO-8601 datetime
 * @property {string}        endsAt             ISO-8601 datetime
 * @property {string}        [location]
 * @property {string[]}      attendees          webids
 * @property {string}        organiser          webid
 * @property {Object<string, 'accepted'|'declined'|'tentative'>} rsvp
 * @property {'open'|'cancelled'} state
 * @property {number}        addedAt
 * @property {string}        addedBy
 * @property {number}        [cancelledAt]
 * @property {string}        [cancelledBy]
 */

export class CalendarStore {
  /** @type {import('@canopy/pseudo-pod').PseudoPod} */
  #pod;
  /** @type {string} */
  #actorDefault;

  /**
   * @param {object}  [opts]
   * @param {object}  [opts.pseudoPod]   pre-wired pseudo-pod; otherwise we build one in-memory
   * @param {string}  [opts.actor='webid:local-demo-user']
   * @param {string}  [opts.deviceId=DEVICE_ID]
   */
  constructor(opts = {}) {
    this.#pod = opts.pseudoPod ?? createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'standalone',
      deviceId: opts.deviceId ?? DEVICE_ID,
    });
    this.#actorDefault = opts.actor ?? 'webid:local-demo-user';
  }

  /**
   * Create an event.  Returns the persisted item.
   *
   * @param {object} args
   * @returns {Promise<CalendarEvent>}
   */
  async addEvent(args = {}) {
    const title = String(args.title ?? '').trim();
    if (!title) throw new Error('CalendarStore.addEvent: title required');
    const startsAt = parseDateInput(args.startsAt);
    if (!startsAt) throw new Error('CalendarStore.addEvent: startsAt required (ISO-8601)');
    const endsAt   = parseDateInput(args.endsAt)
                    ?? new Date(new Date(startsAt).getTime() + 3_600_000).toISOString();
    const attendees = normaliseAttendees(args.attendees);
    const actor     = args.actor ?? this.#actorDefault;
    const organiser = args.organiser ?? actor;

    const event = {
      id:        generateId(),
      type:      TYPE,
      title,
      startsAt,
      endsAt,
      ...(args.location ? { location: String(args.location) } : {}),
      attendees,
      organiser,
      rsvp:    {},
      state:   'open',
      addedAt: Date.now(),
      addedBy: actor,
    };

    await this.#write(event);
    return event;
  }

  /**
   * List events whose startsAt is in [since, until).
   *
   * @param {object} [opts]
   * @returns {Promise<CalendarEvent[]>}
   */
  async listInRange(opts = {}) {
    const since = toEpoch(opts.since) ?? Date.now();
    const until = toEpoch(opts.until) ?? (since + 7 * 86_400_000);
    const all = await this.#readAll();
    return all
      .filter((e) => e.state === 'open')
      .filter((e) => {
        const t = new Date(e.startsAt).getTime();
        return t >= since && t < until;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }

  /**
   * RSVP — record an attendee's response on the event.
   *
   * @param {{eventId: string, actor: string, response: 'accepted'|'declined'|'tentative'}} args
   * @returns {Promise<CalendarEvent>}
   */
  async rsvp({ eventId, actor, response }) {
    if (!['accepted', 'declined', 'tentative'].includes(response)) {
      throw new Error(`CalendarStore.rsvp: bad response "${response}"`);
    }
    const event = await this.getById(eventId);
    if (!event) throw new Error(`CalendarStore.rsvp: no event with id "${eventId}"`);
    const next = { ...event, rsvp: { ...(event.rsvp ?? {}), [actor]: response } };
    await this.#write(next);
    return next;
  }

  /**
   * Cancel an event.
   *
   * @param {{eventId: string, actor?: string}} args
   * @returns {Promise<{ id: string }>}
   */
  async cancel({ eventId, actor }) {
    const event = await this.getById(eventId);
    if (!event) throw new Error(`CalendarStore.cancel: no event with id "${eventId}"`);
    const next = {
      ...event,
      state:        'cancelled',
      cancelledAt:  Date.now(),
      cancelledBy:  actor ?? this.#actorDefault,
    };
    await this.#write(next);
    return { id: eventId };
  }

  /**
   * Search events by title / location substring.  Case-insensitive.
   *
   * @param {string} query
   * @returns {Promise<CalendarEvent[]>}
   */
  async search(query) {
    const q = String(query ?? '').toLowerCase().trim();
    if (!q) return [];
    const all = await this.#readAll();
    return all
      .filter((e) => e.state === 'open')
      .filter((e) =>
        e.title.toLowerCase().includes(q)
        || (e.location ?? '').toLowerCase().includes(q),
      );
  }

  /** Direct get by id. */
  async getById(id) {
    if (!id) return null;
    try {
      const raw = await this.#pod.read(`${ROOT}${id}.json`);
      return parseEvent(raw);
    } catch {
      return null;
    }
  }

  /* ─── internals ─────────────────────────────────────── */

  async #write(event) {
    await this.#pod.write(`${ROOT}${event.id}.json`, JSON.stringify(event), {
      contentType: 'application/json',
    });
  }

  async #readAll() {
    const keys = await this.#pod.list(ROOT);
    const out = [];
    for (const key of (keys ?? [])) {
      const raw = await this.#pod.read(key);
      const event = parseEvent(raw);
      if (event) out.push(event);
    }
    return out;
  }
}

/* ─── helpers ─────────────────────────────────────────── */

function parseEvent(raw) {
  if (raw === null || raw === undefined) return null;
  // Already a calendar-event object?
  if (typeof raw === 'object' && raw.type === TYPE) return raw;
  // pseudo-pod's read returns { uri, bytes, etag, _v } — the JSON
  // payload lives in `bytes` (string).  Older shapes used `text`
  // or `body`; we accept all three for defensive forward-compat.
  const str = typeof raw === 'string'
    ? raw
    : (raw?.bytes ?? raw?.text ?? raw?.body ?? null);
  if (typeof str !== 'string') return null;
  try {
    const parsed = JSON.parse(str);
    return parsed?.type === TYPE ? parsed : null;
  } catch { return null; }
}

function parseDateInput(input) {
  if (!input) return null;
  if (typeof input === 'string' && input !== '') {
    const d = new Date(input);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return input.toISOString();
  }
  return null;
}

function toEpoch(input) {
  if (input === undefined || input === null) return null;
  if (typeof input === 'number') return input;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function normaliseAttendees(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String).filter(Boolean);
  if (typeof input === 'string') {
    return input.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function generateId() {
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = Math.random().toString(36).slice(2, 10);
  return `evt-${time}-${rand}`;
}

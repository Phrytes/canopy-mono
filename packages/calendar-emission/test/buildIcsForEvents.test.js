/**
 * @onderling/calendar-emission — buildIcsForEvents tests (v0.7.11 add).
 *
 * The pre-existing tasks-v0 emitter tests cover buildIcsFor (task
 * shape).  These cover the new calendar-event-shape path.
 */
import { describe, it, expect } from 'vitest';

import { buildIcsForEvents } from '../src/emitter.js';

describe('buildIcsForEvents', () => {
  it("rejects non-array events", () => {
    expect(() => buildIcsForEvents({})).toThrow(/events/);
    expect(() => buildIcsForEvents({ events: null })).toThrow(/events/);
  });

  it("emits empty VCALENDAR for empty events", () => {
    const ics = buildIcsForEvents({ events: [], calendarName: 'My Calendar' });
    expect(ics).toMatch(/^BEGIN:VCALENDAR/);
    expect(ics).toMatch(/END:VCALENDAR\s*$/);
    expect(ics).toMatch(/X-WR-CALNAME:My Calendar/);
    expect(ics).not.toMatch(/BEGIN:VEVENT/);
  });

  it("emits one VEVENT per event with UID + SUMMARY + DTSTART + DTEND", () => {
    const ics = buildIcsForEvents({
      events: [{
        id: 'evt-1',
        type: 'calendar-event',
        title: 'Team standup',
        startsAt: '2026-06-01T09:00:00.000Z',
        endsAt:   '2026-06-01T09:30:00.000Z',
        attendees: [],
      }],
    });
    expect(ics).toMatch(/BEGIN:VEVENT/);
    expect(ics).toMatch(/UID:evt-1/);
    expect(ics).toMatch(/SUMMARY:Team standup/);
    expect(ics).toMatch(/DTSTART:20260601T090000Z/);
    expect(ics).toMatch(/DTEND:20260601T093000Z/);
  });

  it("defaults DTEND to DTSTART + 1h when endsAt absent", () => {
    const ics = buildIcsForEvents({
      events: [{ id: 'e', type: 'calendar-event', title: 'X', startsAt: '2026-06-01T10:00:00Z', attendees: [] }],
    });
    expect(ics).toMatch(/DTEND:20260601T110000Z/);
  });

  it("STATUS:CANCELLED for cancelled events", () => {
    const ics = buildIcsForEvents({
      events: [{
        id: 'e', type: 'calendar-event', title: 'Cancelled',
        startsAt: '2026-06-01T10:00:00Z', endsAt: '2026-06-01T11:00:00Z',
        state: 'cancelled', attendees: [],
      }],
    });
    expect(ics).toMatch(/STATUS:CANCELLED/);
  });

  it("LOCATION when present", () => {
    const ics = buildIcsForEvents({
      events: [{ id: 'e', type: 'calendar-event', title: 'X',
                 startsAt: '2026-06-01T10:00:00Z', endsAt: '2026-06-01T11:00:00Z',
                 location: 'Café Rotterdam', attendees: [] }],
    });
    expect(ics).toMatch(/LOCATION:Café Rotterdam/);
  });

  it("ORGANIZER + ATTENDEE per attendee + PARTSTAT from rsvp", () => {
    const ics = buildIcsForEvents({
      events: [{
        id: 'e', type: 'calendar-event', title: 'Drinks',
        startsAt: '2026-06-01T18:00:00Z', endsAt: '2026-06-01T20:00:00Z',
        organiser: 'webid:frits',
        attendees: ['webid:anne', 'webid:karl', 'webid:maria'],
        rsvp: {
          'webid:anne':  'accepted',
          'webid:karl':  'declined',
          'webid:maria': 'tentative',
        },
      }],
    });
    expect(ics).toMatch(/ORGANIZER:mailto:webid:frits/);
    expect(ics).toMatch(/ATTENDEE;PARTSTAT=ACCEPTED:mailto:webid:anne/);
    expect(ics).toMatch(/ATTENDEE;PARTSTAT=DECLINED:mailto:webid:karl/);
    expect(ics).toMatch(/ATTENDEE;PARTSTAT=TENTATIVE:mailto:webid:maria/);
  });

  it("PARTSTAT=NEEDS-ACTION for attendees without a response", () => {
    const ics = buildIcsForEvents({
      events: [{
        id: 'e', type: 'calendar-event', title: 'Pending',
        startsAt: '2026-06-01T10:00:00Z',
        attendees: ['webid:nobody'],
      }],
    });
    expect(ics).toMatch(/ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:webid:nobody/);
  });

  it("truncates summary to 80 chars", () => {
    const long = 'A'.repeat(100);
    const ics = buildIcsForEvents({
      events: [{ id: 'e', type: 'calendar-event', title: long, startsAt: '2026-06-01T10:00:00Z', attendees: [] }],
    });
    // ical.js may line-fold; reconstruct the SUMMARY value by joining
    // a SUMMARY line + any continuation lines (leading space).
    const lines = ics.split(/\r?\n/);
    const startIdx = lines.findIndex((l) => l.startsWith('SUMMARY:'));
    expect(startIdx).toBeGreaterThanOrEqual(0);
    let value = lines[startIdx].slice('SUMMARY:'.length);
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith(' ')) value += lines[i].slice(1);
      else break;
    }
    expect(value.length).toBe(80);          // truncated exactly to 80
    expect(value).toBe('A'.repeat(80));
  });

  it("skips events with missing id or startsAt", () => {
    const ics = buildIcsForEvents({
      events: [
        { id: 'good', type: 'calendar-event', title: 'OK', startsAt: '2026-06-01T10:00:00Z', attendees: [] },
        { id: 'bad-no-startsAt', type: 'calendar-event', title: 'Bad' },
        { type: 'calendar-event', title: 'No id', startsAt: '2026-06-01T11:00:00Z' },
      ],
    });
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect(ics).toMatch(/UID:good/);
  });

  it("custom prodId + calendarName flow through", () => {
    const ics = buildIcsForEvents({
      events: [],
      calendarName: 'Anne\'s personal cal',
      prodId:       '-//demo-calendar//EN',
    });
    expect(ics).toMatch(/PRODID:-\/\/demo-calendar\/\/EN/);
    expect(ics).toMatch(/X-WR-CALNAME:Anne's personal cal/);
  });
});

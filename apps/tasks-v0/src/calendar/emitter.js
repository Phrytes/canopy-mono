/**
 * Calendar write-side — re-exports from the lifted substrate.
 *
 * Originally lived here (Tasks V2.1).  Lifted to
 * @onderling/calendar-emission on 2026-05-23 per the rule-of-two
 * (canopy-chat v0.7.11 = second consumer).  This file remains so
 * existing tasks-v0 imports (skills/planner.js, tests) keep
 * working with zero churn.
 */
export {
  buildIcsFor, buildCancellationIcs, diffRemoved,
} from '@onderling/calendar-emission';

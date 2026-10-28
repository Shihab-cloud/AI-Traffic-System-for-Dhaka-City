import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

/**
 * Registers the dayjs plugins this app cannot run without.
 *
 * Imported for its side effect by `ContextProvider` — so registration happens
 * once at the app root — and by every module that calls `dayjs.utc` or
 * `dayjs.tz`, so that module works no matter what renders first. Extending
 * twice is a no-op.
 *
 * The alternative — registering inside whichever utility happened to need a
 * plugin first — makes `dayjs.utc` being defined a question of import order,
 * which is exactly the kind of bug that only shows up in a production bundle.
 *
 * - `utc`: read a stored calendar date back in UTC instead of the viewer's zone,
 *   so a date-only value does not shift a day across timezones.
 * - `timezone`: resolve "today" in a chosen zone rather than the viewer's.
 * - `relativeTime`: `.fromNow()` for "3 minutes ago" readouts.
 */
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

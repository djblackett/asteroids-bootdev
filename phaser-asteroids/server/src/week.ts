/**
 * The weekly leaderboard window: Monday 00:00 to the next Monday 00:00 in a named IANA time zone (default America/Halifax),
 * computed from the server's own clock. "Local midnight" is converted to a UTC instant with the zone's real offset at that
 * moment, so a week that contains a daylight-saving change is 167 or 169 hours long rather than a fixed 168.
 */

export interface WeekWindow {
  /** Inclusive, epoch ms. */
  startMs: number;
  /** Exclusive, epoch ms: the start of the following week. */
  endMs: number;
  timeZone: string;
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 = Monday ... 7 = Sunday */
  isoWeekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(ms))) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    isoWeekday: WEEKDAYS[out.weekday!] ?? 1,
  };
}

/** The zone's UTC offset (local minus UTC) in ms at the instant `ms`. */
function offsetAt(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `timeZone` reads 00:00:00 on the given calendar date. */
function localMidnightUtc(year: number, month: number, day: number, timeZone: string): number {
  const naive = Date.UTC(year, month - 1, day);
  // Two refinement steps settle on the right offset even when the offset at `naive` differs from the offset at midnight.
  const first = naive - offsetAt(naive, timeZone);
  return naive - offsetAt(first, timeZone);
}

export function weekWindow(nowMs: number, timeZone: string): WeekWindow {
  const local = zonedParts(nowMs, timeZone);
  // Calendar arithmetic on the local date only (Date.UTC normalises overflowing days), so DST never skews it.
  const monday = new Date(Date.UTC(local.year, local.month - 1, local.day - (local.isoWeekday - 1)));
  const nextMonday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 7));
  return {
    startMs: localMidnightUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), timeZone),
    endMs: localMidnightUtc(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth() + 1, nextMonday.getUTCDate(), timeZone),
    timeZone,
  };
}

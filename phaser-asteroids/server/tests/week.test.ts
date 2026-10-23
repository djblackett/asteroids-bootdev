import { describe, expect, it } from 'vitest';
import { weekWindow, zonedParts } from '../src/week';

const TZ = 'America/Halifax';
const iso = (ms: number) => new Date(ms).toISOString();
const hours = (w: { startMs: number; endMs: number }) => (w.endMs - w.startMs) / 3_600_000;

describe('weekly window (Monday-Sunday, America/Halifax)', () => {
  it('a mid-week instant maps to the Monday 00:00 ADT start (UTC-3 in October)', () => {
    const w = weekWindow(Date.UTC(2026, 9, 22, 15, 0, 0), TZ); // Thursday
    expect(iso(w.startMs)).toBe('2026-10-19T03:00:00.000Z');
    expect(iso(w.endMs)).toBe('2026-10-26T03:00:00.000Z');
    expect(hours(w)).toBe(168);
  });

  it('flips exactly at Halifax Monday midnight, not at UTC midnight', () => {
    const lastMomentOfOldWeek = Date.UTC(2026, 9, 26, 2, 59, 59, 999); // Sunday 23:59:59.999 ADT
    const firstMomentOfNewWeek = Date.UTC(2026, 9, 26, 3, 0, 0, 0); // Monday 00:00:00.000 ADT
    expect(iso(weekWindow(lastMomentOfOldWeek, TZ).startMs)).toBe('2026-10-19T03:00:00.000Z');
    expect(iso(weekWindow(firstMomentOfNewWeek, TZ).startMs)).toBe('2026-10-26T03:00:00.000Z');
    // Sunday evening in Halifax is already Monday in UTC, which must NOT roll the week over.
    expect(iso(weekWindow(Date.UTC(2026, 9, 26, 1, 0, 0), TZ).startMs)).toBe('2026-10-19T03:00:00.000Z');
  });

  it('the week containing the autumn DST change (2026-11-01) is 169 hours long', () => {
    const w = weekWindow(Date.UTC(2026, 10, 1, 12, 0, 0), TZ); // Sunday after clocks went back
    expect(iso(w.startMs)).toBe('2026-10-26T03:00:00.000Z'); // Monday 00:00 ADT (UTC-3)
    expect(iso(w.endMs)).toBe('2026-11-02T04:00:00.000Z'); // Monday 00:00 AST (UTC-4)
    expect(hours(w)).toBe(169);
  });

  it('the week containing the spring DST change (2026-03-08) is 167 hours long', () => {
    const w = weekWindow(Date.UTC(2026, 2, 9, 12, 0, 0), TZ);
    // Monday 2026-03-09 is after the change: week starts that day at 00:00 ADT (UTC-3).
    expect(iso(w.startMs)).toBe('2026-03-09T03:00:00.000Z');
    const prior = weekWindow(Date.UTC(2026, 2, 8, 12, 0, 0), TZ);
    expect(iso(prior.startMs)).toBe('2026-03-02T04:00:00.000Z'); // Monday 00:00 AST (UTC-4)
    expect(iso(prior.endMs)).toBe('2026-03-09T03:00:00.000Z');
    expect(hours(prior)).toBe(167);
  });

  it('crosses the New Year inside a single week (Mon 2026-12-28 to Mon 2027-01-04)', () => {
    for (const day of [28, 29, 30, 31]) {
      const w = weekWindow(Date.UTC(2026, 11, day, 18, 0, 0), TZ);
      expect(iso(w.startMs)).toBe('2026-12-28T04:00:00.000Z');
      expect(iso(w.endMs)).toBe('2027-01-04T04:00:00.000Z');
    }
    expect(iso(weekWindow(Date.UTC(2027, 0, 1, 18, 0, 0), TZ).startMs)).toBe('2026-12-28T04:00:00.000Z');
    expect(iso(weekWindow(Date.UTC(2027, 0, 4, 4, 0, 0), TZ).startMs)).toBe('2027-01-04T04:00:00.000Z');
  });

  it('handles a Sunday and a Monday correctly in the same zone', () => {
    expect(zonedParts(Date.UTC(2026, 9, 25, 12, 0, 0), TZ).isoWeekday).toBe(7);
    expect(zonedParts(Date.UTC(2026, 9, 26, 12, 0, 0), TZ).isoWeekday).toBe(1);
  });

  it('every instant belongs to exactly one window and windows tile the timeline', () => {
    let t = Date.UTC(2026, 0, 1);
    const end = Date.UTC(2027, 1, 1);
    let prev = weekWindow(t, TZ);
    for (; t < end; t += 6 * 3_600_000 + 17_000) {
      const w = weekWindow(t, TZ);
      expect(t).toBeGreaterThanOrEqual(w.startMs);
      expect(t).toBeLessThan(w.endMs);
      if (w.startMs !== prev.startMs) expect(w.startMs).toBe(prev.endMs);
      prev = w;
    }
  });
});

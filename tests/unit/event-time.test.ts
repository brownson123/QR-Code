import { describe, expect, it } from 'vitest';
import { zonedToUtc } from '@/lib/domain/event-time';

describe('event wall-clock time → UTC (I-8)', () => {
  it('converts in the event timezone, on both sides of the DST change', () => {
    expect(zonedToUtc('2026-10-03T09:00', 'America/Toronto')).toBe('2026-10-03T13:00:00.000Z'); // EDT
    expect(zonedToUtc('2026-10-31T22:00', 'America/Toronto')).toBe('2026-11-01T02:00:00.000Z'); // EDT
    expect(zonedToUtc('2026-11-01T04:00', 'America/Toronto')).toBe('2026-11-01T09:00:00.000Z'); // EST
    expect(zonedToUtc('2026-12-01T09:00', 'America/Toronto')).toBe('2026-12-01T14:00:00.000Z'); // EST
    expect(zonedToUtc('2026-07-01T09:00', 'Europe/London')).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc('2026-07-01T09:00', 'UTC')).toBe('2026-07-01T09:00:00.000Z');
  });

  it('rejects malformed input', () => {
    expect(() => zonedToUtc('2026-10-03 09:00', 'America/Toronto')).toThrow();
    expect(() => zonedToUtc('2026-10-03T09:00', 'Mars/Olympus')).toThrow();
  });
});

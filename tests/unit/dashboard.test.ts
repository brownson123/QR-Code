import { describe, expect, it } from 'vitest';
import { bucketLabel, doorClosedWarning } from '@/lib/domain/dashboard';

const startsAt = '2026-10-03T13:00:00Z';
const endsAt = '2026-10-03T23:00:00Z';
const at = (iso: string) => new Date(iso);

describe('dashboard rules (SPEC §11, §13)', () => {
  it('T-ADM-06: warns when within 30 min of starts_at and the door is closed, until the event ends', () => {
    expect(doorClosedWarning({ now: at('2026-10-03T12:40:00Z'), startsAt, endsAt, doorOpen: false })).toBe(true);
    expect(doorClosedWarning({ now: at('2026-10-03T12:30:00Z'), startsAt, endsAt, doorOpen: false })).toBe(true);
    expect(doorClosedWarning({ now: at('2026-10-03T12:29:00Z'), startsAt, endsAt, doorOpen: false })).toBe(false);
    expect(doorClosedWarning({ now: at('2026-10-03T14:00:00Z'), startsAt, endsAt, doorOpen: false })).toBe(true);
    expect(doorClosedWarning({ now: at('2026-10-03T12:40:00Z'), startsAt, endsAt, doorOpen: true })).toBe(false);
    expect(doorClosedWarning({ now: at('2026-10-03T23:00:00Z'), startsAt, endsAt, doorOpen: false })).toBe(false);
  });

  it('T-ANA-03: 01:00–02:00 on 2026-11-01 in Toronto gets two distinct labels (EDT, then EST)', () => {
    expect(bucketLabel('2026-11-01T05:00:00Z', 'America/Toronto')).toBe('1:00 AM EDT');
    expect(bucketLabel('2026-11-01T06:00:00Z', 'America/Toronto')).toBe('1:00 AM EST');
    expect(bucketLabel('2026-11-01T05:15:00Z', 'America/Toronto')).toBe('1:15 AM EDT');
  });
});

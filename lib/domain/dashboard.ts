// SPEC §11 / §13 dashboard rules. Pure: `now` is a parameter.

const THIRTY_MIN_MS = 30 * 60 * 1000;

// §11: warn if within 30 min of starts_at and the door is closed (and keep warning until it opens
// or the event ends). No door checkpoint counts as closed.
export function doorClosedWarning(input: { now: Date; startsAt: string; endsAt: string; doorOpen: boolean }): boolean {
  const now = input.now.getTime();
  return !input.doorOpen && now >= Date.parse(input.startsAt) - THIRTY_MIN_MS && now < Date.parse(input.endsAt);
}

// §13: buckets are computed in UTC and only *labelled* in the event timezone, so the repeated
// 01:00–02:00 hour on DST day shows as two distinct labels (EDT, then EST).
export function bucketLabel(utcIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(utcIso));
}

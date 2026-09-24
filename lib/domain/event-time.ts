// I-8: event times are shown in the event's timezone, never the device's.
// Example: "Sat, Oct 3 · 9:00 AM EDT".
export function formatEventDateTime(at: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(new Date(at));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')}, ${get('month')} ${get('day')} · ${get('hour')}:${get('minute')} ${get('dayPeriod')} ${get('timeZoneName')}`;
}

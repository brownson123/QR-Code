import { describe, expect, it } from 'vitest';
import { renderPassEmail } from '@/lib/email/templates/pass';

const base = {
  firstName: 'Ada',
  event: { name: 'Hack Day 2026', venue: 'Bahen Centre, Room 1180', startsAt: '2026-10-03T13:00:00Z', timezone: 'America/Toronto' },
  passUrl: 'https://passline.example.com/p#Ab3_-xYz0123456789abcdefGHIJKLMN',
  qrPng: Buffer.from('fake-png'),
};

describe('pass email template (SPEC §12)', () => {
  it('T-MAIL-07: contains name, event, local time with TZ abbreviation, venue, cid QR, /p# link, plain-text part', () => {
    const m = renderPassEmail(base);
    expect(m.subject).toBe("You're in: Hack Day 2026 — your check-in pass");
    for (const part of [m.html, m.text]) {
      expect(part).toContain('Ada');
      expect(part).toContain('Hack Day 2026');
      expect(part).toContain('Sat, Oct 3 · 9:00 AM EDT');
      expect(part).toContain('Bahen Centre, Room 1180');
      expect(part).toContain(base.passUrl);
    }
    expect(m.html).toContain('src="cid:qr"');
    expect(m.inlineImages).toEqual([{ cid: 'qr', filename: 'passline-qr.png', contentType: 'image/png', content: base.qrPng }]);
    // §12 order: greeting, event, time, venue, QR, link.
    const order = ['Ada', 'Hack Day 2026', 'Sat, Oct 3', 'Bahen Centre', 'cid:qr', 'Open your pass'].map((s) => m.html.indexOf(s));
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > (order[i - 1] ?? 0)))).toBe(true);
  });

  it('T-MAIL-07: local time uses the event timezone, not the device (EST after DST ends)', () => {
    const m = renderPassEmail({ ...base, event: { ...base.event, startsAt: '2026-11-07T15:30:00Z' } });
    expect(m.text).toContain('Sat, Nov 7 · 10:30 AM EST');
  });

  it('T-MAIL-08: a first name of <b>x</b> is escaped in the HTML', () => {
    const m = renderPassEmail({ ...base, firstName: '<b>x</b>', event: { ...base.event, name: 'A & "B"' } });
    expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(m.html).not.toContain('<b>x</b>');
    expect(m.html).toContain('A &amp; &quot;B&quot;');
  });

  it('T-MAIL-09: rendered HTML is under 60 KB', () => {
    const m = renderPassEmail({ ...base, firstName: 'x'.repeat(100), event: { ...base.event, name: 'y'.repeat(200) } });
    expect(Buffer.byteLength(m.html, 'utf8')).toBeLessThan(60 * 1024);
  });
});

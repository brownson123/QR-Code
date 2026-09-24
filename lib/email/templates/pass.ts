import { formatEventDateTime } from '@/lib/domain/event-time';
import { escapeHtml } from '@/lib/domain/html';
import type { InlineImage } from '../provider';

export interface PassEmailInput {
  firstName: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  passUrl: string;
  qrPng: Buffer;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  inlineImages: InlineImage[];
}

// SPEC §12. Body order: greeting, event, local time, venue, QR, pass link, tips, photo link,
// organizer contact, privacy line. The QR is an inline cid: attachment, never a data: URI.
export function renderPassEmail(input: PassEmailInput): RenderedEmail {
  const when = formatEventDateTime(input.event.startsAt, input.event.timezone);
  const e = {
    first: escapeHtml(input.firstName),
    event: escapeHtml(input.event.name),
    when: escapeHtml(when),
    venue: escapeHtml(input.event.venue),
    url: escapeHtml(input.passUrl),
  };

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<p>Hi ${e.first},</p>
<p>You're in for <strong>${e.event}</strong>.</p>
<p><strong>When:</strong> ${e.when}<br><strong>Where:</strong> ${e.venue}</p>
<p><img src="cid:qr" width="300" height="300" alt="Your check-in QR code" style="display:block;background:#ffffff"></p>
<p><a href="${e.url}">Open your pass</a></p>
<ul>
<li>Turn your screen brightness up at the door.</li>
<li>A screenshot of this code works fine.</li>
<li>This code is personal. Don't share it.</li>
</ul>
<p><a href="${e.url}">Add a photo for faster check-in</a> (optional).</p>
<p>Questions? Just reply to this email.</p>
<p style="font-size:12px;color:#555555">We use your details only to run ${e.event}: admission, meals and attendance. Photos and dietary notes are deleted 30 days after the event.</p>
</body></html>`;

  const text = [
    `Hi ${input.firstName},`,
    '',
    `You're in for ${input.event.name}.`,
    '',
    `When: ${when}`,
    `Where: ${input.event.venue}`,
    '',
    `Open your pass (shows your QR code): ${input.passUrl}`,
    '',
    'Tips: turn your screen brightness up at the door. A screenshot of the code works fine. This code is personal; don\'t share it.',
    '',
    `Add a photo for faster check-in (optional): ${input.passUrl}`,
    '',
    'Questions? Just reply to this email.',
    '',
    `We use your details only to run ${input.event.name}: admission, meals and attendance. Photos and dietary notes are deleted 30 days after the event.`,
  ].join('\n');

  return {
    subject: `You're in: ${input.event.name} — your check-in pass`,
    html,
    text,
    inlineImages: [{ cid: 'qr', filename: 'passline-qr.png', contentType: 'image/png', content: input.qrPng }],
  };
}

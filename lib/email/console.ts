import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EmailMessage, EmailProvider } from './provider';

// Dev/test provider (SPEC §12): writes an .eml file you can open in a mail client. No network.
export function createConsoleProvider(opts: { dir?: string } = {}): EmailProvider {
  const dir = opts.dir ?? join(process.cwd(), '.mail');
  return {
    name: 'console',
    async send(message) {
      const id = `console-${randomUUID()}`;
      await mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await writeFile(join(dir, `${stamp}-${id}.eml`), toMime(message, id), 'utf8');
      return { id };
    },
  };
}

function wrap64(buf: Buffer): string {
  return (buf.toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

function toMime(m: EmailMessage, id: string): string {
  const rel = `rel-${id}`;
  const alt = `alt-${id}`;
  const lines = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: =?utf-8?B?${Buffer.from(m.subject, 'utf8').toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${id}@passline.local>`,
    `X-Idempotency-Key: ${m.idempotencyKey}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${rel}"`,
    '',
    `--${rel}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap64(Buffer.from(m.text, 'utf8')),
    `--${alt}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap64(Buffer.from(m.html, 'utf8')),
    `--${alt}--`,
    ...m.inlineImages.flatMap((img) => [
      `--${rel}`,
      `Content-Type: ${img.contentType}; name="${img.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="${img.filename}"`,
      '',
      wrap64(img.content),
    ]),
    `--${rel}--`,
    '',
  ];
  return lines.join('\r\n');
}

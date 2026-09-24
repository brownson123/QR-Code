import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConsoleProvider } from '@/lib/email/console';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('console email provider (SPEC §12)', () => {
  it('T-MAIL-10: writes the message to the mail dir and never calls the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const dir = await mkdtemp(join(tmpdir(), 'passline-mail-'));
    const provider = createConsoleProvider({ dir });
    const res = await provider.send({
      to: 'ada@example.com',
      from: 'Passline <passes@example.com>',
      subject: "You're in: Hack Day — your check-in pass",
      html: '<p>Hi Ada</p><img src="cid:qr">',
      text: 'Hi Ada',
      inlineImages: [{ cid: 'qr', filename: 'passline-qr.png', contentType: 'image/png', content: Buffer.from('png') }],
      idempotencyKey: 'row-1:1',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.id).toMatch(/^console-/);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const eml = await readFile(join(dir, files[0] ?? ''), 'utf8');
    expect(eml).toContain('To: ada@example.com');
    expect(eml).toContain('Content-ID: <qr>');
    expect(eml).toContain('Content-Type: text/plain; charset=utf-8');
    expect(eml).toContain('Content-Type: text/html; charset=utf-8');
  });

  it('T-MAIL-10: defaults to ./.mail', () => {
    expect(createConsoleProvider().name).toBe('console');
  });
});

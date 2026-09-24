// `pnpm gen:qr-video <token-or-text> [out.y4m]`: a fake-camera video for Chromium's
// --use-file-for-fake-video-capture (CLAUDE.md testing rules). A 32-char token becomes the real pass
// payload `${APP_ORIGIN}/p#<token>`; any other text is encoded literally (e.g. https://example.com).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { QR_OPTIONS } from '@/lib/qr/options';

export async function generateQrVideo(text: string, out: string, appOrigin: string): Promise<void> {
  const payload = /^[A-Za-z0-9_-]{32}$/.test(text) ? `${appOrigin}/p#${text}` : text;
  const png = join(mkdtempSync(join(tmpdir(), 'qr-video-')), 'qr.png');
  writeFileSync(png, await QRCode.toBuffer(payload, { ...QR_OPTIONS, type: 'png' }));
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-loop', '1', '-i', png,
    '-vf', 'scale=420:420,pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p',
    '-t', '2', '-r', '10', '-pix_fmt', 'yuv420p', out,
  ]);
}

if (process.argv[1]?.endsWith('gen-qr-video.ts')) {
  const [text, out = 'tests/assets/qr.y4m'] = process.argv.slice(2);
  if (!text) {
    console.error('usage: pnpm gen:qr-video <token-or-text> [out.y4m]');
    process.exit(1);
  }
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'http://localhost:3000';
  generateQrVideo(text, out, origin).then(
    () => console.log(`wrote ${out}`),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}

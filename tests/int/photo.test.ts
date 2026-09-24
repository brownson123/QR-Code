import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signedPhotoUrl, PHOTO_URL_TTL_SECONDS } from '@/lib/storage/photos';
import { requireEnv } from '../fixtures/db';
import { passClient } from '../fixtures/pass';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';
import { awaitFreshWindow } from '../fixtures/window';

let f: StandardFixture;
let c: ReturnType<typeof passClient>;
beforeEach(async () => {
  f = await createStandardFixture();
  c = passClient();
});
afterEach(async () => {
  await f.close();
});

const MB = 1024 * 1024;
const RED = { r: 220, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 220 };

async function smallJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: RED } }).jpeg().toBuffer();
}

// Pad a valid image after its end marker; decoders stop at EOI/IEND.
function padTo(image: Buffer, size: number): Buffer {
  return Buffer.concat([image, Buffer.alloc(size - image.length)]);
}

async function pixel(img: Buffer, x: number, y: number) {
  const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 };
}

async function storedPhoto(participantId: string): Promise<{ path: string; bytes: Buffer }> {
  const { rows } = await f.pool.query<{ photo_path: string }>('select photo_path from participants where id = $1', [participantId]);
  const path = rows[0]?.photo_path ?? '';
  const { data, error } = await c.db.storage.from('photos').download(path);
  if (error) throw error;
  return { path, bytes: Buffer.from(await data.arrayBuffer()) };
}

describe('POST /api/pass/photo (SPEC F5)', () => {
  it('T-PASS-04: JPEG with GPS EXIF + orientation 6 → 512×512 JPEG, no EXIF, upright', async () => {
    // Upright: red top half, blue bottom half. Stored rotated 90° CCW and tagged orientation 6.
    const upright = await sharp({ create: { width: 300, height: 400, channels: 3, background: BLUE } })
      .composite([{ input: { create: { width: 300, height: 200, channels: 3, background: RED } }, top: 0, left: 0 }])
      .png()
      .toBuffer();
    const input = await sharp(upright)
      .rotate(270)
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '43/1 39/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '79/1 23/1 0/1' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const inMeta = await sharp(input).metadata();
    expect(inMeta.orientation).toBe(6);
    expect(inMeta.exif?.length ?? 0).toBeGreaterThan(0);

    const res = await c.upload(f.token.A, input);
    expect(res.status).toBe(200);
    const { path, bytes } = await storedPhoto(f.p.A);
    expect(path).toBe(`${f.e1.id}/${f.p.A}.jpg`);
    const meta = await sharp(bytes).metadata();
    expect({ format: meta.format, width: meta.width, height: meta.height }).toEqual({ format: 'jpeg', width: 512, height: 512 });
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    const top = await pixel(bytes, 256, 40);
    const bottom = await pixel(bytes, 256, 470);
    expect(top.r).toBeGreaterThan(150);
    expect(top.b).toBeLessThan(80);
    expect(bottom.b).toBeGreaterThan(150);
    expect(bottom.r).toBeLessThan(80);
  });

  it('T-PASS-05: PNG and WebP are accepted; an 8 MB file is accepted; 8 MB + 1 byte is 413', async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: BLUE } }).png().toBuffer();
    const webp = await sharp({ create: { width: 40, height: 40, channels: 3, background: BLUE } }).webp().toBuffer();
    expect((await c.upload(f.token.A, png, { name: 'a.png', type: 'image/png' })).status).toBe(200);
    expect((await c.upload(f.token.A, webp, { name: 'a.webp', type: 'image/webp' })).status).toBe(200);
    const jpeg = await smallJpeg();
    expect((await c.upload(f.token.B, padTo(jpeg, 8 * MB))).status).toBe(200);
    expect((await c.upload(f.token.N, padTo(jpeg, 8 * MB + 1))).status).toBe(413);
  });

  it('T-PASS-05: a declared body far over the limit is rejected before parsing', async () => {
    expect((await c.upload(f.token.A, await smallJpeg(), { contentLength: String(20 * MB) })).status).toBe(413);
  });

  it('T-PASS-06: a PDF renamed .jpg and an SVG are 415 (magic bytes, not name/MIME)', async () => {
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    expect((await c.upload(f.token.A, pdf, { name: 'photo.jpg', type: 'image/jpeg' })).status).toBe(415);
    expect((await c.upload(f.token.A, svg, { name: 'photo.svg', type: 'image/svg+xml' })).status).toBe(415);
    const { rows } = await f.pool.query('select photo_path from participants where id = $1 and photo_path is not null', [f.p.A]);
    expect(rows).toHaveLength(0);
  });

  it('T-PASS-07: upload after door check-in is 409 PHOTO_LOCKED', async () => {
    await f.checkIn(f.p.A, f.token.A);
    const res = await c.upload(f.token.A, await smallJpeg());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'PHOTO_LOCKED' });
  });

  it('T-PASS-08: the public bucket URL is refused; a signed URL works; signed URLs expire', async () => {
    expect((await c.upload(f.token.A, await smallJpeg())).status).toBe(200);
    const { path } = await storedPhoto(f.p.A);
    const publicUrl = `${requireEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/public/photos/${path}`;
    const pub = await fetch(publicUrl);
    expect([400, 403, 404]).toContain(pub.status);

    const signed = await signedPhotoUrl(c.db, path);
    const ok = await fetch(signed);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    const jwt = new URL(signed).searchParams.get('token') ?? '';
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp: number; iat: number };
    expect(PHOTO_URL_TTL_SECONDS).toBe(300);
    expect(claims.exp - claims.iat).toBe(300);

    const shortLived = await signedPhotoUrl(c.db, path, 1);
    await new Promise((r) => setTimeout(r, 2500));
    expect((await fetch(shortLived)).status).toBeGreaterThanOrEqual(400);
  });

  it('T-PASS-09: the 11th upload within an hour is 429', async () => {
    const jpeg = await smallJpeg();
    await awaitFreshWindow(3600, 20);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await c.upload(f.token.B, jpeg)).status);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
  });

  it('F5: unknown, replaced and cancelled tokens cannot upload (404)', async () => {
    const jpeg = await smallJpeg();
    expect((await c.upload('x'.repeat(32), jpeg)).status).toBe(404);
    expect((await c.upload(f.rvOldToken, jpeg)).status).toBe(404);
    expect((await c.upload(f.token.Wd, jpeg)).status).toBe(404);
  });
});

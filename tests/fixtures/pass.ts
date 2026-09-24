import { randomBytes } from 'node:crypto';
import { createPassHandler, createPhotoHandler } from '@/lib/pass/handlers';
import { serviceClient } from './mail';

// Each client gets its own fake IP so per-IP rate limits never leak between tests.
export function passClient() {
  const db = serviceClient();
  const ip = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  const pass = createPassHandler({ db });
  const photo = createPhotoHandler({ db });

  const lookup = (body: unknown, headers: Record<string, string> = {}) =>
    pass(
      new Request('http://localhost/api/pass', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 172.16.0.1`, ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );

  const upload = (token: string, data: Uint8Array, opts: { name?: string; type?: string; contentLength?: string } = {}) => {
    const form = new FormData();
    form.set('token', token);
    form.set('file', new File([Buffer.from(data)], opts.name ?? 'photo.jpg', { type: opts.type ?? 'image/jpeg' }));
    const req = new Request('http://localhost/api/pass/photo', { method: 'POST', body: form });
    if (opts.contentLength) {
      const headers = new Headers(req.headers);
      headers.set('content-length', opts.contentLength);
      return photo(new Request(req, { headers }));
    }
    return photo(req);
  };

  return { db, ip, lookup, upload };
}

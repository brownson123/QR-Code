import { describe, expect, it } from 'vitest';
import { securityHeaders } from '@/lib/domain/security-headers';

const SUPABASE = 'https://abc.supabase.co';
const get = (headers: Array<{ key: string; value: string }>, key: string) => headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
const directive = (csp: string | undefined, name: string) =>
  csp
    ?.split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `) || d === name);

describe('security headers (SPEC §14.12)', () => {
  const prod = securityHeaders({ production: true, supabaseUrl: SUPABASE });
  const dev = securityHeaders({ production: false, supabaseUrl: 'http://127.0.0.1:54321' });

  it("T-SEC-06: CSP forbids framing, plugins and foreign scripts", () => {
    const csp = get(prod, 'Content-Security-Policy');
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
  });

  it('T-SEC-06: Supabase is reachable for auth (connect) and signed photos (img), nothing else', () => {
    const csp = get(prod, 'Content-Security-Policy');
    expect(directive(csp, 'connect-src')).toBe(`connect-src 'self' ${SUPABASE}`);
    expect(directive(csp, 'img-src')).toBe(`img-src 'self' blob: data: ${SUPABASE}`);
  });

  it('T-SEC-06: camera only for our own origin; no microphone or geolocation', () => {
    expect(get(prod, 'Permissions-Policy')).toBe('camera=(self), microphone=(), geolocation=()');
  });

  it('T-SEC-06: HSTS in production only (localhost must stay usable over http)', () => {
    expect(get(prod, 'Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    expect(get(dev, 'Strict-Transport-Security')).toBeUndefined();
  });

  it('T-SEC-06: dev allows eval + websocket for the dev server; prod does not', () => {
    const devCsp = get(dev, 'Content-Security-Policy');
    expect(directive(devCsp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(devCsp, 'connect-src')).toContain('ws:');
    expect(get(prod, 'Content-Security-Policy')).not.toContain("'unsafe-eval'");
    expect(get(prod, 'Content-Security-Policy')).not.toContain('ws:');
  });

  it('T-SEC-06: nosniff, DENY framing and no referrer', () => {
    expect(get(prod, 'X-Content-Type-Options')).toBe('nosniff');
    expect(get(prod, 'X-Frame-Options')).toBe('DENY');
    expect(get(prod, 'Referrer-Policy')).toBe('no-referrer');
  });
});

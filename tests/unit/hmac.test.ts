import { describe, expect, it } from 'vitest';
import { signSheetBody, verifySheetSignature } from '@/lib/domain/hmac';

const secret = 's'.repeat(40);
const now = 1_790_000_000;
const body = '{"event_slug":"x","rows":[]}';

function check(over: Partial<Parameters<typeof verifySheetSignature>[0]>) {
  const ts = String(now);
  return verifySheetSignature({ rawBody: body, timestamp: ts, signature: signSheetBody(body, ts, secret), secret, nowSeconds: now, ...over });
}

describe('sheet ingest HMAC (SPEC §9.2)', () => {
  it('T-ING-01: a valid signature over "timestamp.rawBody" verifies', () => {
    expect(check({})).toBe(true);
  });

  it('T-ING-02: off-by-one hex char, wrong secret, missing or malformed headers are rejected', () => {
    const ts = String(now);
    const sig = signSheetBody(body, ts, secret);
    const flipped = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    expect(check({ signature: flipped })).toBe(false);
    expect(check({ signature: signSheetBody(body, ts, 'wrong'.repeat(8)) })).toBe(false);
    expect(check({ signature: null })).toBe(false);
    expect(check({ timestamp: null })).toBe(false);
    expect(check({ signature: sig.toUpperCase() })).toBe(false);
    expect(check({ signature: sig.slice(0, 62) })).toBe(false);
    expect(check({ signature: `${sig}00` })).toBe(false);
    expect(check({ rawBody: `${body} ` })).toBe(false);
  });

  it('T-ING-03: a timestamp 301 s old or 301 s in the future is rejected; 300 s is accepted', () => {
    for (const [offset, ok] of [[-301, false], [301, false], [-300, true], [300, true]] as const) {
      const ts = String(now + offset);
      expect(verifySheetSignature({ rawBody: body, timestamp: ts, signature: signSheetBody(body, ts, secret), secret, nowSeconds: now })).toBe(ok);
    }
    expect(check({ timestamp: '17900000.5' })).toBe(false);
  });

  it('T-ING-05: non-ASCII bodies are signed over their UTF-8 bytes', () => {
    const utf8 = '{"rows":[{"first_name":"Zoë 李雷 محمد"}]}';
    const ts = String(now);
    const expected = '' + signSheetBody(utf8, ts, secret);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySheetSignature({ rawBody: utf8, timestamp: ts, signature: expected, secret, nowSeconds: now })).toBe(true);
  });
});

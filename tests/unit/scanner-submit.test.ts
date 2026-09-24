import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitScan } from '@/lib/scanner/submit';

const body = {
  checkpointId: '0b8b4e0e-9a1c-4c5e-8a55-4b8f3e0d6c11',
  method: 'qr' as const,
  token: 'Ab3_-xYz0123456789abcdefGHIJKLMN',
  clientScanId: '3f2b7a9e-1c4d-4e8f-9a0b-2c3d4e5f6a7b',
  clientScannedAt: '2026-10-03T13:00:00.000Z',
};
const accepted = { code: 'ACCEPTED', replayed: false, serverTime: '2026-10-03T13:00:00.100Z' };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// A fetch that never answers but honours abort, like a hung server.
const hang: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

describe('submitScan (SPEC §10.2 network rules)', () => {
  it('T-SCUI-04: 8 s timeout, then 2 retries with the SAME clientScanId, then network', async () => {
    const fetchImpl = vi.fn(hang);
    const pending = submitScan(body, { fetchImpl });
    await vi.advanceTimersByTimeAsync(8000 * 3 + 10);
    expect(await pending).toEqual({ kind: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const ids = fetchImpl.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { clientScanId: string }).clientScanId);
    expect(new Set(ids)).toEqual(new Set([body.clientScanId]));
  });

  it('T-SCUI-04: a 5xx is retried; a retry that succeeds returns the server answer', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('oops', { status: 502 }))
      .mockResolvedValueOnce(Response.json(accepted));
    expect(await submitScan(body, { fetchImpl })).toEqual({ kind: 'response', data: accepted });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('I-1: an unparseable 200 is "network" (amber), never a response', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('<html>proxy</html>', { status: 200 }));
    expect(await submitScan(body, { fetchImpl })).toEqual({ kind: 'network' });
    const wrong = vi.fn<typeof fetch>(async () => Response.json({ code: 'ADMIT', serverTime: 'x' }));
    expect(await submitScan(body, { fetchImpl: wrong })).toEqual({ kind: 'network' });
  });

  it('T-SCUI-05: a network-level failure is "offline" immediately (no retries)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await submitScan(body, { fetchImpl })).toEqual({ kind: 'offline' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('T-SCUI-10: 401 is "unauthorized"; 429 is "rate_limited"; neither retries', async () => {
    const f401 = vi.fn<typeof fetch>(async () => new Response('{}', { status: 401 }));
    const f429 = vi.fn<typeof fetch>(async () => new Response('{}', { status: 429 }));
    expect(await submitScan(body, { fetchImpl: f401 })).toEqual({ kind: 'unauthorized' });
    expect(await submitScan(body, { fetchImpl: f429 })).toEqual({ kind: 'rate_limited' });
    expect(f401).toHaveBeenCalledTimes(1);
    expect(f429).toHaveBeenCalledTimes(1);
  });
});

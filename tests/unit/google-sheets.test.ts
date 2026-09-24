import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { getAccessToken, readSheetValues } from '@/lib/sheets/google';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { client_email: 'sync@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };

const b64url = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Record<string, unknown>;

describe('Google Sheets client (SPEC F10; Google APIs are mocked)', () => {
  it('T-ING-25: exchanges a signed RS256 JWT with a read-only scope for an access token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ access_token: 'ya29.x', expires_in: 3600 }));
    expect(await getAccessToken(sa, { fetchImpl, nowSeconds: 1_790_000_000 })).toBe('ya29.x');
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h = '', c = '', s = ''] = (form.get('assertion') ?? '').split('.');
    expect(b64url(h)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(b64url(c)).toEqual({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_790_000_000,
      exp: 1_790_003_600,
    });
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('T-ING-25: reads the tab values with the bearer token; ragged rows come back as strings', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input).startsWith('https://oauth2')
        ? Response.json({ access_token: 'ya29.x' })
        : Response.json({ values: [['Applicant ID', 'Status'], ['id-1']] }),
    );
    const values = await readSheetValues({ sheetId: 'sheet123', tab: 'Form Responses 1', serviceAccount: sa, fetchImpl });
    expect(values).toEqual([['Applicant ID', 'Status'], ['id-1']]);
    const [url, init] = fetchImpl.mock.calls[1] ?? [];
    expect(String(url)).toBe(
      'https://sheets.googleapis.com/v4/spreadsheets/sheet123/values/Form%20Responses%201?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE',
    );
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ya29.x');
  });

  it('T-ING-25: a Google error surfaces as a thrown error without the response body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"error":"secret detail"}', { status: 403 }));
    await expect(getAccessToken(sa, { fetchImpl })).rejects.toThrow(/403/);
    await expect(getAccessToken(sa, { fetchImpl })).rejects.not.toThrow(/secret detail/);
  });
});

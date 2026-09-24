import { createSign } from 'node:crypto';
import { z } from 'zod';

// SPEC F10 "Sync now": read the Sheet with a service account (read-only scope).
// A hand-rolled RS256 JWT exchange instead of the ~80 MB googleapis package.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export const serviceAccountSchema = z.object({ client_email: z.string().min(3), private_key: z.string().min(1) });
export type ServiceAccount = z.infer<typeof serviceAccountSchema>;

export function parseServiceAccount(json: string): ServiceAccount {
  return serviceAccountSchema.parse(JSON.parse(json));
}

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');

export async function getAccessToken(
  sa: ServiceAccount,
  opts: { fetchImpl?: typeof fetch; nowSeconds?: number } = {},
): Promise<string> {
  const iat = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await (opts.fetchImpl ?? fetch)(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: HTTP ${res.status}`);
  const body = z.object({ access_token: z.string().min(1) }).parse(await res.json());
  return body.access_token;
}

export async function readSheetValues(input: {
  sheetId: string;
  tab: string;
  serviceAccount: ServiceAccount;
  fetchImpl?: typeof fetch;
}): Promise<string[][]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = await getAccessToken(input.serviceAccount, { fetchImpl });
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.sheetId)}` +
    `/values/${encodeURIComponent(input.tab)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google Sheets read failed: HTTP ${res.status}`);
  const body = z.object({ values: z.array(z.array(z.unknown())).optional() }).parse(await res.json());
  return (body.values ?? []).map((row) => row.map((v) => (v === null || v === undefined ? '' : String(v))));
}

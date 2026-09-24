// SPEC §6.4. Client-safe: runs in the scanner before any network request.

export type ParseResult = { ok: true; token: string } | { ok: false; reason: 'MALFORMED' };

const MAX_LENGTH = 2048;
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const MALFORMED: ParseResult = { ok: false, reason: 'MALFORMED' };

export function parseScannedText(raw: string, appOrigin: string): ParseResult {
  if (typeof raw !== 'string' || raw.length > MAX_LENGTH) return MALFORMED;
  const text = raw.trim();
  // A literal prefix match: no regex built from the origin, so nothing in it needs escaping.
  const prefix = `${appOrigin}/p#`;
  const candidate = text.startsWith(prefix) ? text.slice(prefix.length) : text;
  return TOKEN.test(candidate) ? { ok: true, token: candidate } : MALFORMED;
}

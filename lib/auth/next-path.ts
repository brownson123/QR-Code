// Only same-site relative paths may be used as a post-login destination (no open redirects).
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}

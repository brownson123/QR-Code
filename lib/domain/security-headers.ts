// SPEC T-SEC-06. Pure: the caller says whether this is production and where Supabase lives.
//
// No nonces: Next.js inlines bootstrap scripts, so script-src needs 'unsafe-inline' unless every page
// is rendered dynamically with a per-request nonce. The real protection here is that there is no
// third-party script origin at all, plus frame-ancestors/object-src/base-uri lockdown.
// 'wasm-unsafe-eval' is for the self-hosted zxing decoder (public/zxing).
export function securityHeaders(opts: { production: boolean; supabaseUrl: string }): Array<{ key: string; value: string }> {
  const supabase = new URL(opts.supabaseUrl).origin;
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${opts.production ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${supabase}`,
    "font-src 'self'",
    `connect-src 'self' ${supabase}${opts.production ? '' : ' ws:'}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    // Tokens only ever live in the fragment, which browsers never send; this is belt and braces.
    { key: 'Referrer-Policy', value: 'no-referrer' },
    ...(opts.production ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
  ];
}

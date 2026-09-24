import type { NextConfig } from 'next';
import { securityHeaders } from './lib/domain/security-headers';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // forbidden() in the admin layout returns a real 403 (T-ADM-01). Experimental in Next 16.
  experimental: { authInterrupts: true },
  // T-SEC-06: on every response, pages and API routes alike.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders({
          production: process.env.NODE_ENV === 'production',
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
        }),
      },
    ];
  },
};

export default nextConfig;

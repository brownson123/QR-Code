import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // forbidden() in the admin layout returns a real 403 (T-ADM-01). Experimental in Next 16.
  experimental: { authInterrupts: true },
};

export default nextConfig;

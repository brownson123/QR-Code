import type { Metadata } from 'next';
import { PassView } from './pass-view';

// SPEC F5. The token lives only in the URL fragment, which browsers never send to the server (I-3).
export const metadata: Metadata = {
  title: 'Your pass · Passline',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function PassPage() {
  return <PassView />;
}

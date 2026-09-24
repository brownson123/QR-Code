import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import type { EmailMessage, EmailProvider } from '@/lib/email/provider';
import { requireEnv } from './db';

export function serviceClient(): SupabaseClient<Database> {
  return createClient<Database>(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// CLAUDE.md: the email provider is one of the few things tests may mock.
export function mockProvider(behaviour: (m: EmailMessage) => Promise<void> | void = () => undefined) {
  const sent: EmailMessage[] = [];
  const provider: EmailProvider = {
    name: 'mock',
    async send(m) {
      await behaviour(m);
      sent.push(m);
      return { id: `mock-${sent.length}` };
    },
  };
  return { provider, sent };
}

export function tokenFromEmail(m: EmailMessage): string {
  const match = /\/p#([A-Za-z0-9_-]{32})/.exec(m.text);
  if (!match?.[1]) throw new Error('no pass link in email');
  return match[1];
}

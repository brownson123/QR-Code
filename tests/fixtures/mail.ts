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

// drainOutbox() drains every due row in the database, including rows other test files left pending,
// so assertions must only look at mail addressed to the test's own participants.
export function sentTo(sent: EmailMessage[], address: string): EmailMessage[] {
  return sent.filter((m) => m.to === address);
}

export function onlyEmailTo(sent: EmailMessage[], address: string): EmailMessage {
  const mine = sentTo(sent, address);
  if (mine.length !== 1) throw new Error(`expected exactly one email to the participant, got ${mine.length}`);
  return mine[0] as EmailMessage;
}

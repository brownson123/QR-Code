'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useState } from 'react';
import styles from './login.module.css';

export function LoginForm({ next }: { next: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim();
    setState('sending');
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '');
    const redirect = new URL('/auth/callback', window.location.origin);
    redirect.searchParams.set('next', next);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect.toString() } });
    setState(error ? 'error' : 'sent');
  }

  if (state === 'sent') {
    return (
      <p role="status" className={styles.ok}>
        ✓ Check your email for a sign-in link. You can close this tab.
      </p>
    );
  }
  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" required className={styles.input} />
      <button type="submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
      </button>
      {state === 'error' && (
        <p role="alert" className={styles.error}>
          ✕ Couldn&apos;t send the link. Wait a moment and try again.
        </p>
      )}
    </form>
  );
}

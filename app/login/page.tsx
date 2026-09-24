import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/auth/next-path';
import { LoginForm } from './login-form';
import styles from './login.module.css';

export const metadata: Metadata = { title: 'Staff sign-in · Passline', robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className={styles.page}>
      <h1>Staff sign-in</h1>
      <p>We&apos;ll email you a sign-in link. Use the address your organizer invited.</p>
      {error && (
        <p role="alert" className={styles.error}>
          ✕ That sign-in link didn&apos;t work or has expired. Request a new one.
        </p>
      )}
      <LoginForm next={safeNextPath(next, '/')} />
    </main>
  );
}

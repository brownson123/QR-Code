import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeNextPath } from '@/lib/auth/next-path';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import styles from '../login/login.module.css';

export const metadata: Metadata = { title: 'Your name · Passline', robots: { index: false } };

const nameSchema = z.string().trim().min(1).max(60);

// SPEC F9 step 2: the name other volunteers see ("ALREADY SCANNED 12:03 PM by Maya").
async function saveName(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login');
  const next = safeNextPath(String(formData.get('next') ?? ''));
  const name = nameSchema.safeParse(formData.get('display_name'));
  if (!name.success) redirect(`/onboarding?invalid=1&next=${encodeURIComponent(next)}`);
  const { error } = await db().from('staff_profiles').upsert({ user_id: user.id, display_name: name.data });
  if (error) throw new Error(`staff_profiles upsert failed (${error.code})`);
  redirect(next);
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string; invalid?: string }> }) {
  const user = await currentUser();
  const { next, invalid } = await searchParams;
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNextPath(next))}`);
  return (
    <main className={styles.page}>
      <h1>What should volunteers call you?</h1>
      <p>Other staff see this name next to your scans.</p>
      <form action={saveName} className={styles.form}>
        <input type="hidden" name="next" value={safeNextPath(next)} />
        <label htmlFor="display_name">Display name</label>
        <input id="display_name" name="display_name" required maxLength={60} className={styles.input} autoComplete="nickname" />
        {invalid && (
          <p role="alert" className={styles.error}>
            ✕ Enter a name between 1 and 60 characters.
          </p>
        )}
        <button type="submit">Continue</button>
      </form>
    </main>
  );
}

import type { Metadata } from 'next';
import { forbidden, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireStaffBySlug } from '@/lib/auth/staff';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import styles from './admin.module.css';
import { AdminNav } from './nav';

export const metadata: Metadata = { title: 'Admin · Passline', robots: { index: false } };

// SPEC §3 / §11: organizer only, checked server-side before anything about the event is read (I-5).
// forbidden() answers with HTTP 403 (T-ADM-01). Every API the pages call re-checks on its own.
export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/admin/${slug}`)}`);
  const staff = await requireStaffBySlug(db(), user.id, slug, 'organizer');
  if (!staff) forbidden();
  const { data: event, error } = await db().from('events').select('name').eq('id', staff.eventId).single();
  if (error) throw new Error(`event load failed (${error.code})`);
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.eventName}>{event.name}</div>
        <AdminNav slug={slug} />
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

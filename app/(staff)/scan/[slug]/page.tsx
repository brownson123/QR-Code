import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireStaffBySlug } from '@/lib/auth/staff';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { env } from '@/lib/env';
import { Scanner } from './scanner';
import styles from './scanner.module.css';

export const metadata: Metadata = { title: 'Scanner · Passline', robots: { index: false } };

export default async function ScanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/scan/${slug}`)}`);
  const staff = await requireStaffBySlug(db(), user.id, slug);
  if (!staff) {
    return (
      <main className={styles.noAccess}>
        <h1>✕ No access to this event</h1>
        <p>Ask an organizer to invite the email you signed in with.</p>
      </main>
    );
  }
  const { data: event, error } = await db().from('events').select('name, timezone').eq('id', staff.eventId).single();
  if (error) throw new Error(`event load failed (${error.code})`);
  return <Scanner slug={slug} eventName={event.name} timezone={event.timezone} appOrigin={env().NEXT_PUBLIC_APP_ORIGIN} />;
}

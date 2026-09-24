'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './admin.module.css';

const TABS = [
  ['', 'Dashboard'],
  ['/participants', 'Participants'],
  ['/checkpoints', 'Checkpoints'],
  ['/staff', 'Staff'],
  ['/sync', 'Sync'],
  ['/export', 'Export'],
] as const;

export function AdminNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/admin/${slug}`;
  return (
    <nav aria-label="Admin" className={styles.nav}>
      {TABS.map(([path, label]) => {
        const href = base + path;
        return (
          <Link key={label} href={href} className={styles.tab} aria-current={pathname === href ? 'page' : undefined}>
            {label}
          </Link>
        );
      })}
      <Link href={`/scan/${slug}`} className={styles.tab}>
        Scanner ↗
      </Link>
    </nav>
  );
}

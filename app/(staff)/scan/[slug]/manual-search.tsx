'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { searchQuery } from '@/lib/domain/search';
import styles from './scanner.module.css';

interface Row {
  id: string;
  displayName: string;
  status: string;
  email: string;
  photoUrl: string | null;
  scannedHere: boolean;
}

type SearchState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'rows'; rows: Row[] } | { kind: 'error' };

// SPEC §10.4. Results come from the server; nothing is cached on the device.
export function ManualSearch(props: {
  slug: string;
  checkpointId: string;
  disabled: boolean;
  onRecord: (participantId: string) => void;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const valid = searchQuery(q) !== null;

  useEffect(() => {
    if (!valid) return;
    let stale = false;
    const t = setTimeout(async () => {
      setState({ kind: 'loading' });
      try {
        const url = `/api/events/${encodeURIComponent(props.slug)}/participants/search?q=${encodeURIComponent(q)}&checkpointId=${props.checkpointId}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (stale) return;
        if (res.status === 401) return props.onUnauthorized();
        if (!res.ok) return setState({ kind: 'error' });
        const body = (await res.json()) as { results: Row[] };
        if (!stale) setState({ kind: 'rows', rows: body.results });
      } catch {
        if (!stale) setState({ kind: 'error' });
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, valid, props]);

  return (
    <section className={styles.sheet} aria-labelledby="search-title">
      <div className={styles.sheetHeader}>
        <h2 id="search-title">Manual search</h2>
        <button type="button" className={styles.secondary} onClick={props.onClose}>
          Close
        </button>
      </div>
      <label htmlFor="manual-q" className="visually-hidden">
        Name
      </label>
      <input
        id="manual-q"
        className={styles.searchInput}
        placeholder="Type a name"
        autoComplete="off"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {!valid && q !== '' && <p className={styles.notice}>Type at least 2 letters.</p>}
      {valid && state.kind === 'loading' && <p className={styles.notice}>Searching…</p>}
      {valid && state.kind === 'error' && <p className={styles.notice}>✕ Search failed. Try again.</p>}
      {valid && state.kind === 'rows' && state.rows.length === 0 && <p className={styles.notice}>No one found.</p>}
      {valid && state.kind === 'rows' && (
        <ul className={styles.results}>
          {state.rows.map((r) => (
            <li key={r.id} className={styles.row} data-testid="search-row">
              {r.photoUrl ? (
                <Image className={styles.rowPhoto} src={r.photoUrl} alt="" width={56} height={56} unoptimized />
              ) : (
                <span className={styles.rowPhoto} aria-hidden="true" />
              )}
              <div className={styles.rowText}>
                <div className={styles.rowName}>{r.displayName}</div>
                <div className={styles.rowMeta}>
                  <span className={styles.badge}>{r.status}</span>
                  {r.scannedHere && <span className={`${styles.badge} ${styles.badgeWarn}`}>✓ Already scanned here</span>}
                  {r.email}
                </div>
              </div>
              <button type="button" disabled={props.disabled} onClick={() => props.onRecord(r.id)} aria-label={`Record scan for ${r.displayName}`}>
                Record scan
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

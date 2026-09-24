'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatEventDateTime } from '@/lib/domain/event-time';
import styles from './admin.module.css';
import { adminUrl, errorText, useApi } from './api';
import { ArrivalsChart, type ArrivalBucket } from './arrivals-chart';

type Kind = 'door' | 'meal' | 'session' | 'custom';
interface DashboardData {
  event: { name: string; startsAt: string; endsAt: string; timezone: string };
  generatedAt: string;
  accepted: number;
  checkedIn: number;
  checkInRate: number;
  noShows: number;
  checkpoints: Array<{ id: string; name: string; kind: Kind; isOpen: boolean; capacity: number | null; liveScans: number; fill: number | null; uptake?: number | null }>;
  sessionRanking: Array<{ id: string; name: string; liveScans: number; capacity: number | null }>;
  arrivals: ArrivalBucket[];
  outbox: { pending: number; failed: number };
  alerts: { doorClosed: boolean; notFound: Array<{ staffUserId: string; displayName: string | null; count: number }> };
  scanProblems: Array<{ checkpointId: string | null; code: string; count: number }>;
}

const POLL_MS = 10_000; // SPEC §11
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n * 100)}%`);

export function Dashboard({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<DashboardData>(adminUrl(slug, '/dashboard'));
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else if (r.status !== 401) setError(errorText(r));
  }, [api, slug]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  if (!data) return <p>{error ? `✕ ${error}` : 'Loading dashboard…'}</p>;
  const tz = data.event.timezone;
  const cpName = new Map(data.checkpoints.map((c) => [c.id, c.name]));

  return (
    <>
      <h1>Dashboard</h1>
      {error && (
        <p className={`${styles.alert} ${styles.alertWarn}`} role="status">
          ! Couldn’t refresh: {error} Showing data from {formatEventDateTime(data.generatedAt, tz)}.
        </p>
      )}
      {data.alerts.doorClosed && (
        <p className={`${styles.alert} ${styles.alertBad}`} role="alert">
          ⚠ The door is closed and the event starts {formatEventDateTime(data.event.startsAt, tz)}. Open it on the Checkpoints tab.
        </p>
      )}
      {data.alerts.notFound.map((a) => (
        <p key={a.staffUserId} className={`${styles.alert} ${styles.alertBad}`} role="alert">
          ⚠ {a.displayName ?? 'A staff member'} got {a.count} “unknown code” results in 5 minutes and is being rate-limited.
        </p>
      ))}
      {data.outbox.failed > 0 && (
        <p className={`${styles.alert} ${styles.alertWarn}`} role="alert">
          ! {data.outbox.failed} pass email{data.outbox.failed === 1 ? '' : 's'} failed to send. Resend from Participants.
        </p>
      )}

      <div className={styles.tiles}>
        <Tile id="accepted" label="Accepted" value={data.accepted} />
        <Tile id="checked-in" label="Checked in" value={data.checkedIn} hint={`${pct(data.checkInRate)} of accepted`} />
        <Tile id="no-shows" label="Not arrived" value={data.noShows} />
        <Tile id="outbox" label="Emails pending" value={data.outbox.pending} hint={`${data.outbox.failed} failed`} />
      </div>

      <h2>Checkpoints</h2>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Checkpoint</th>
              <th>Kind</th>
              <th>State</th>
              <th className={styles.num}>Scans</th>
              <th className={styles.num}>Fill</th>
              <th className={styles.num}>Meal uptake</th>
            </tr>
          </thead>
          <tbody>
            {data.checkpoints.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.kind}</td>
                <td>
                  <span className={`${styles.badge} ${c.isOpen ? styles.badgeOk : ''}`}>{c.isOpen ? '● Open' : '○ Closed'}</span>
                </td>
                <td className={styles.num}>
                  {c.liveScans}
                  {c.capacity ? ` / ${c.capacity}` : ''}
                </td>
                <td className={styles.num}>{pct(c.fill)}</td>
                <td className={styles.num}>{c.kind === 'meal' ? pct(c.uptake) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Door arrivals per 15 minutes</h2>
      <ArrivalsChart buckets={data.arrivals} />

      {data.sessionRanking.length > 0 && (
        <>
          <h2>Session attendance</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Session</th>
                  <th className={styles.num}>Attended</th>
                  <th className={styles.num}>Capacity</th>
                </tr>
              </thead>
              <tbody>
                {data.sessionRanking.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className={styles.num}>{s.liveScans}</td>
                    <td className={styles.num}>{s.capacity ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Scan problems</h2>
      {data.scanProblems.length === 0 ? (
        <p className={styles.muted}>None so far.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Checkpoint</th>
                <th>Result</th>
                <th className={styles.num}>Count</th>
              </tr>
            </thead>
            <tbody>
              {data.scanProblems.map((p) => (
                <tr key={`${p.checkpointId ?? ''}-${p.code}`}>
                  <td>{(p.checkpointId && cpName.get(p.checkpointId)) ?? '—'}</td>
                  <td>{p.code}</td>
                  <td className={styles.num}>{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.muted}>Updated {formatEventDateTime(data.generatedAt, tz)} · refreshes every 10 s</p>
    </>
  );
}

function Tile(props: { id: string; label: string; value: number; hint?: string }) {
  return (
    <div className={styles.tile} data-testid={`kpi-${props.id}`}>
      <span className={styles.tileLabel}>{props.label}</span>
      <span className={styles.tileValue}>{props.value.toLocaleString('en-US')}</span>
      {props.hint && <span className={styles.tileHint}>{props.hint}</span>}
    </div>
  );
}

'use client';

import { useCallback, useState } from 'react';
import { formatEventDateTime } from '@/lib/domain/event-time';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad } from '../api';

interface EventInfo {
  timezone: string;
  sheetId: string | null;
  lastSyncAt: string | null;
}
interface Report {
  dryRun: boolean;
  total: number;
  counts: Record<string, number>;
  changes: Array<{ external_id: string; result: string }>;
}

const SYNC_ERRORS: Record<string, string> = {
  NOT_CONFIGURED: 'No Google Sheet is linked, or Sync now isn’t set up on the server (GOOGLE_SERVICE_ACCOUNT_JSON). Link the Sheet above and share it with the service account.',
  SHEET_READ_FAILED: 'Couldn’t read the Sheet. Check that it’s shared with the service account.',
};

// F10: dry run → review the diff → apply. The same upsert code as the live Sheet sync.
export function Sync({ slug }: { slug: string }) {
  const api = useApi();
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [sheet, setSheet] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<EventInfo>(adminUrl(slug, '/event'));
    if (r.ok) setEvent(r.data);
    else setError(errorText(r));
  }, [api, slug]);

  useLoad(load);

  async function link(value: string | null) {
    const r = await api<{ sheetId: string | null }>(adminUrl(slug, '/event'), { method: 'PATCH', body: { sheet: value } });
    if (r.ok) {
      setMessage(value === null ? '✓ Sheet unlinked.' : '✓ Sheet linked.');
      setSheet('');
      setError(null);
    } else setError(r.status === 400 ? 'That doesn’t look like a Google Sheet link or id.' : errorText(r));
    await load();
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const r = await api<Report>(adminUrl(slug, '/sync'), { method: 'POST', body: { dryRun } });
    setBusy(false);
    if (!r.ok) {
      setReport(null);
      setError(SYNC_ERRORS[r.data.error ?? ''] ?? errorText(r));
      return;
    }
    setReport(dryRun ? r.data : null);
    if (!dryRun) {
      setMessage(`✓ Applied ${r.data.total} rows. ${r.data.counts.PASS_QUEUED ?? 0} pass emails queued.`);
      await load();
    }
  }

  return (
    <>
      <h1>Sync with Google Sheet</h1>
      {event && (
        <p>
          {event.sheetId ? (
            <>
              Linked Sheet: <code>{event.sheetId}</code>{' '}
              <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => void link(null)}>
                Unlink
              </button>
            </>
          ) : (
            'No Sheet linked yet.'
          )}
          <br />
          <span className={styles.muted}>Last sync: {event.lastSyncAt ? formatEventDateTime(event.lastSyncAt, event.timezone) : 'never'}</span>
        </p>
      )}
      <form
        className={styles.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          void link(sheet);
        }}
      >
        <label className={styles.field} style={{ flex: 1, minWidth: 240 }}>
          Sheet link or id
          <input className={styles.input} value={sheet} required onChange={(e) => setSheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
        </label>
        <button type="submit" className={styles.secondary}>
          Link Sheet
        </button>
      </form>

      <div className={styles.toolbar}>
        <button type="button" disabled={busy} onClick={() => void run(true)}>
          Sync now (preview)
        </button>
      </div>
      {error && (
        <p className={`${styles.alert} ${styles.alertBad}`} role="alert">
          ✕ {error}
        </p>
      )}
      {message && (
        <p className={`${styles.alert} ${styles.alertOk}`} role="status">
          {message}
        </p>
      )}
      {report && (
        <section aria-labelledby="diff-title">
          <h2 id="diff-title">Preview: {report.total} rows read</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Result</th>
                  <th className={styles.num}>Rows</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.counts).map(([code, n]) => (
                  <tr key={code}>
                    <td>{code}</td>
                    <td className={styles.num}>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.changes.length > 0 && (
            <details>
              <summary>{report.changes.length} rows would change (by Applicant ID)</summary>
              <ul>
                {report.changes.map((c) => (
                  <li key={c.external_id}>
                    <code>{c.external_id}</code>: {c.result}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className={styles.toolbar}>
            <button type="button" disabled={busy || report.changes.length === 0} onClick={() => void run(false)}>
              Apply changes
            </button>
            <button type="button" className={styles.secondary} onClick={() => setReport(null)}>
              Discard
            </button>
          </div>
        </section>
      )}
    </>
  );
}

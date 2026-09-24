'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi } from '../api';
import { ConfirmDialog, Modal } from '../dialog';
import { ParticipantDetail } from './detail';
import { fullName } from './name';

export interface Row {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: 'pending' | 'accepted' | 'waitlisted' | 'rejected' | 'withdrawn';
  source: string;
  isTest: boolean;
  hasPhoto: boolean;
  passState: 'active' | 'revoked' | 'none';
  liveScans: number;
  checkedIn: boolean;
}

type Pending = { kind: 'resend' | 'revoke' | 'delete'; row: Row } | { kind: 'walk-in' } | null;
const STATUSES = ['accepted', 'pending', 'waitlisted', 'rejected', 'withdrawn'] as const;

const RESULT_TEXT: Record<string, string> = {
  QUEUED: '✓ New pass queued. Their old code has stopped working.',
  IN_FLIGHT: '! A pass email is already on its way.',
  NOT_ACCEPTED: '! Only accepted participants can get a pass.',
  REVOKED: '✓ Pass revoked.',
  NO_ACTIVE_PASS: '! They had no active pass.',
  DELETED: '✓ Participant deleted. Their scans still count in totals.',
  ALREADY_DELETED: '! Already deleted.',
};

export function Participants({ slug }: { slug: string }) {
  const api = useApi();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [noShow, setNoShow] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q.trim()) params.set('q', q.trim());
    if (noShow) params.set('noShow', '1');
    const r = await api<{ participants: Row[] }>(adminUrl(slug, `/participants?${params}`));
    if (r.ok) setRows(r.data.participants);
    else setMessage(`✕ ${errorText(r)}`);
  }, [api, slug, status, q, noShow]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  async function act(kind: 'resend' | 'revoke' | 'delete', row: Row) {
    setPending(null);
    const path = `/participants/${row.id}${kind === 'delete' ? '' : `/${kind}`}`;
    const r = await api<{ code: string }>(adminUrl(slug, path), { method: kind === 'delete' ? 'DELETE' : 'POST' });
    setMessage(r.ok ? (RESULT_TEXT[r.data.code] ?? r.data.code) : `✕ ${errorText(r)}`);
    if (kind === 'delete' && openId === row.id) setOpenId(null);
    await load();
  }

  async function toggleTest(row: Row) {
    const r = await api(adminUrl(slug, `/participants/${row.id}/test`), { method: 'POST', body: { isTest: !row.isTest } });
    if (!r.ok) setMessage(`✕ ${errorText(r)}`);
    await load();
  }

  return (
    <>
      <h1>Participants</h1>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          Search name
          <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Ada" />
        </label>
        <label className={styles.field}>
          Status
          <select className={styles.input} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={noShow} onChange={(e) => setNoShow(e.target.checked)} /> Not arrived only
        </label>
        <button type="button" onClick={() => setPending({ kind: 'walk-in' })}>
          Add walk-in
        </button>
      </div>
      {message && (
        <p className={styles.alert + ' ' + (message.startsWith('✓') ? styles.alertOk : styles.alertWarn)} role="status">
          {message}
        </p>
      )}

      {openId && <ParticipantDetail slug={slug} id={openId} onClose={() => setOpenId(null)} onChanged={load} />}

      {rows === null ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p className={styles.muted}>No participants match.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Pass</th>
                <th>Arrived</th>
                <th className={styles.num}>Scans</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {fullName(r)}
                    {r.isTest && <span className={styles.badge}> TEST</span>}
                    {r.hasPhoto && <span className={styles.muted}> · 📷</span>}
                  </td>
                  <td>{r.email}</td>
                  <td>
                    <span className={`${styles.badge} ${r.status === 'accepted' ? styles.badgeOk : r.status === 'withdrawn' || r.status === 'rejected' ? styles.badgeBad : ''}`}>{r.status}</span>
                  </td>
                  <td>{r.passState === 'active' ? 'Active' : r.passState === 'revoked' ? 'Revoked' : '—'}</td>
                  <td>{r.checkedIn ? '✓ Checked in' : '—'}</td>
                  <td className={styles.num}>{r.liveScans}</td>
                  <td>
                    <div className={styles.actions}>
                      <button type="button" className={`${styles.secondary} ${styles.small}`} aria-label={`Details for ${fullName(r)}`} onClick={() => setOpenId(r.id)}>
                        Details
                      </button>
                      {r.status === 'accepted' && (
                        <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setPending({ kind: 'resend', row: r })}>
                          Resend pass
                        </button>
                      )}
                      {r.passState === 'active' && (
                        <button type="button" className={`${styles.secondary} ${styles.small}`} onClick={() => setPending({ kind: 'revoke', row: r })}>
                          Revoke
                        </button>
                      )}
                      <button type="button" className={`${styles.secondary} ${styles.small}`} aria-pressed={r.isTest} onClick={() => void toggleTest(r)}>
                        {r.isTest ? 'Unmark test' : 'Mark test'}
                      </button>
                      <button type="button" className={`${styles.danger} ${styles.small}`} onClick={() => setPending({ kind: 'delete', row: r })}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pending?.kind === 'resend' && (
        <ConfirmDialog
          title={`Resend pass to ${fullName(pending.row)}?`}
          body={<p>They’ll get a new email with a new code. Their old code will stop working.</p>}
          confirmLabel="Resend pass"
          onConfirm={() => void act('resend', pending.row)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'revoke' && (
        <ConfirmDialog
          title={`Revoke ${fullName(pending.row)}’s pass?`}
          body={<p>Their code will scan as “pass cancelled”. You can resend a new pass later.</p>}
          confirmLabel="Revoke pass"
          danger
          onConfirm={() => void act('revoke', pending.row)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${fullName(pending.row)}?`}
          body={<p>This removes their name, email, photo and notes, and cancels their pass. Their scans stay in the totals. It can’t be undone.</p>}
          confirmLabel="Delete participant"
          danger
          typeToConfirm="DELETE"
          onConfirm={() => void act('delete', pending.row)}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === 'walk-in' && (
        <WalkInDialog
          slug={slug}
          onDone={async (msg) => {
            setPending(null);
            setMessage(msg);
            await load();
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}

// F12. "Check in now" records a manual door scan through record_scan().
function WalkInDialog(props: { slug: string; onDone: (message: string) => void; onCancel: () => void }) {
  const api = useApi();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [checkInNow, setCheckInNow] = useState(true);
  const [sendPass, setSendPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const r = await api<{ code: string; scan?: { code?: string } }>(adminUrl(props.slug, '/participants'), {
      method: 'POST',
      body: { firstName, lastName, email, checkInNow, sendPass },
    });
    setBusy(false);
    if (!r.ok) {
      const code = (r.data as { code?: string }).code;
      setError(code === 'CONFLICT_DUPLICATE_EMAIL' ? 'Someone in this event already uses that email.' : r.status === 400 ? 'Check the name and email.' : errorText(r));
      return;
    }
    const scanCode = r.data.scan?.code;
    props.onDone(
      !checkInNow || scanCode === 'ACCEPTED'
        ? `✓ Added ${firstName}${checkInNow ? ' and checked them in' : ''}.`
        : `! Added ${firstName}, but check-in failed (${scanCode ?? 'unknown'}). Is the door open?`,
    );
  }

  return (
    <Modal title="Add walk-in" onCancel={props.onCancel}>
      <form
        className={styles.dialogForm}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className={styles.field}>
          First name
          <input className={styles.input} required maxLength={100} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </label>
        <label className={styles.field}>
          Last name
          <input className={styles.input} maxLength={100} value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>
        <label className={styles.field}>
          Email
          <input className={styles.input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={checkInNow} onChange={(e) => setCheckInNow(e.target.checked)} /> Check in now
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={sendPass} onChange={(e) => setSendPass(e.target.checked)} /> Email them a pass
        </label>
        {error && (
          <p className={`${styles.alert} ${styles.alertBad}`} role="alert">
            ✕ {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.secondary} onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            Add walk-in
          </button>
        </div>
      </form>
    </Modal>
  );
}

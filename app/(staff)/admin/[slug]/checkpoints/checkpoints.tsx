'use client';

import { useCallback, useState } from 'react';
import { formatEventDateTime, zonedToUtc } from '@/lib/domain/event-time';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { ConfirmDialog, Modal } from '../dialog';

type Kind = 'door' | 'meal' | 'session' | 'custom';
interface Checkpoint {
  id: string;
  name: string;
  kind: Kind;
  isOpen: boolean;
  requiresCheckin: boolean;
  capacity: number | null;
  startsAt: string | null;
  sortOrder: number;
}

const KINDS: Kind[] = ['door', 'meal', 'session', 'custom'];
const ERROR_TEXT: Record<string, string> = {
  DOOR_EXISTS: 'This event already has a door checkpoint.',
  NAME_TAKEN: 'Another checkpoint already has that name.',
};

export function Checkpoints({ slug }: { slug: string }) {
  const api = useApi();
  const [rows, setRows] = useState<Checkpoint[] | null>(null);
  const [timezone, setTimezone] = useState('UTC');
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Checkpoint | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Checkpoint | null>(null);

  const load = useCallback(async () => {
    const [r, e] = await Promise.all([api<{ checkpoints: Checkpoint[] }>(adminUrl(slug, '/checkpoints')), api<{ timezone: string }>(adminUrl(slug, '/event'))]);
    if (r.ok) setRows(r.data.checkpoints);
    else setMessage(`✕ ${errorText(r)}`);
    if (e.ok) setTimezone(e.data.timezone);
  }, [api, slug]);

  useLoad(load);

  async function toggle(c: Checkpoint) {
    const r = await api(adminUrl(slug, `/checkpoints/${c.id}`), { method: 'PATCH', body: { isOpen: !c.isOpen } });
    setMessage(r.ok ? `✓ ${c.name} is now ${c.isOpen ? 'closed' : 'open'}.` : `✕ ${errorText(r)}`);
    await load();
  }

  async function remove(c: Checkpoint) {
    setDeleting(null);
    const r = await api(adminUrl(slug, `/checkpoints/${c.id}`), { method: 'DELETE' });
    setMessage(r.ok ? `✓ Deleted ${c.name}.` : `✕ ${errorText(r)}`);
    await load();
  }

  return (
    <>
      <h1>Checkpoints</h1>
      <div className={styles.toolbar}>
        <button type="button" onClick={() => setEditing('new')}>
          Add checkpoint
        </button>
      </div>
      {message && (
        <p className={styles.alert + ' ' + (message.startsWith('✓') ? styles.alertOk : styles.alertWarn)} role="status">
          {message}
        </p>
      )}
      {rows === null ? (
        <p>Loading…</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>State</th>
                <th>Needs check-in</th>
                <th className={styles.num}>Capacity</th>
                <th>Starts</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.kind}</td>
                  <td>
                    <span data-testid="cp-state" className={`${styles.badge} ${c.isOpen ? styles.badgeOk : ''}`}>
                      {c.isOpen ? '● Open' : '○ Closed'}
                    </span>
                  </td>
                  <td>{c.requiresCheckin ? 'Yes' : 'No'}</td>
                  <td className={styles.num}>{c.capacity ?? '—'}</td>
                  <td>{c.startsAt ? formatEventDateTime(c.startsAt, timezone) : '—'}</td>
                  <td>
                    <div className={styles.actions}>
                      <button type="button" className={styles.small} aria-label={`${c.isOpen ? 'Close' : 'Open'} ${c.name}`} onClick={() => void toggle(c)}>
                        {c.isOpen ? 'Close' : 'Open'}
                      </button>
                      <button type="button" className={`${styles.secondary} ${styles.small}`} aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                        Edit
                      </button>
                      <button type="button" className={`${styles.danger} ${styles.small}`} aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>
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
      {editing && (
        <CheckpointForm
          slug={slug}
          timezone={timezone}
          initial={editing === 'new' ? null : editing}
          onDone={async (msg) => {
            setEditing(null);
            setMessage(msg);
            await load();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body={<p>Checkpoints that already have scans can’t be deleted. Close them instead.</p>}
          confirmLabel="Delete checkpoint"
          danger
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

// datetime-local value ("2026-10-03T09:00") for an instant, shown in the event timezone (I-8).
function toLocalInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function CheckpointForm(props: { slug: string; timezone: string; initial: Checkpoint | null; onDone: (msg: string) => void; onCancel: () => void }) {
  const api = useApi();
  const init = props.initial;
  const [name, setName] = useState(init?.name ?? '');
  const [kind, setKind] = useState<Kind>(init?.kind ?? 'session');
  const [capacity, setCapacity] = useState(init?.capacity?.toString() ?? '');
  const [requiresCheckin, setRequiresCheckin] = useState(init?.requiresCheckin ?? true);
  const [sortOrder, setSortOrder] = useState(init?.sortOrder.toString() ?? '0');
  const [startsAt, setStartsAt] = useState(init?.startsAt ? toLocalInput(init.startsAt, props.timezone) : '');
  const [error, setError] = useState<string | null>(null);
  const isDoor = kind === 'door';

  async function submit() {
    const cap = capacity.trim() === '' ? null : Number(capacity);
    if (cap !== null && (!Number.isInteger(cap) || cap <= 0)) return setError('Capacity must be a whole number above 0, or empty.');
    const body = {
      name,
      ...(init ? {} : { kind }),
      capacity: cap,
      requiresCheckin: isDoor ? false : requiresCheckin,
      sortOrder: Number(sortOrder) || 0,
      startsAt: startsAt ? zonedToUtc(startsAt, props.timezone) : null,
    };
    const r = init
      ? await api(adminUrl(props.slug, `/checkpoints/${init.id}`), { method: 'PATCH', body })
      : await api(adminUrl(props.slug, '/checkpoints'), { method: 'POST', body });
    if (!r.ok) return setError(ERROR_TEXT[r.data.error ?? ''] ?? (r.status === 400 ? 'Check the fields.' : errorText(r)));
    props.onDone(`✓ ${init ? 'Saved' : 'Added'} ${name}.${init ? '' : ' It starts closed.'}`);
  }

  return (
    <Modal title={init ? `Edit ${init.name}` : 'Add checkpoint'} onCancel={props.onCancel}>
      <form
        className={styles.dialogForm}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className={styles.field}>
          Name
          <input className={styles.input} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={styles.field}>
          Kind
          <select className={styles.input} value={kind} disabled={init !== null} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Capacity (optional)
          <input className={styles.input} inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={isDoor ? false : requiresCheckin} disabled={isDoor} onChange={(e) => setRequiresCheckin(e.target.checked)} /> Requires door check-in first
        </label>
        <label className={styles.field}>
          Starts ({props.timezone}, optional)
          <input className={styles.input} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className={styles.field}>
          Sort order
          <input className={styles.input} inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
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
          <button type="submit">{init ? 'Save' : 'Add checkpoint'}</button>
        </div>
      </form>
    </Modal>
  );
}

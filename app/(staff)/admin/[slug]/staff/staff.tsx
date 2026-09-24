'use client';

import { useCallback, useState } from 'react';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { ConfirmDialog } from '../dialog';

interface StaffData {
  staff: Array<{ userId: string; role: 'organizer' | 'volunteer'; displayName: string | null; isMe: boolean }>;
  invites: Array<{ email: string; role: 'organizer' | 'volunteer' }>;
}
type Pending = { kind: 'remove'; userId: string; name: string } | { kind: 'cancel'; email: string } | null;

// F9: invite by email + role; the invite is consumed on first sign-in.
export function Staff({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<StaffData | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'volunteer' | 'organizer'>('volunteer');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(async () => {
    const r = await api<StaffData>(adminUrl(slug, '/staff'));
    if (r.ok) setData(r.data);
    else setMessage(`✕ ${errorText(r)}`);
  }, [api, slug]);

  useLoad(load);

  async function invite() {
    const r = await api<{ code: string }>(adminUrl(slug, '/staff/invites'), { method: 'POST', body: { email, role } });
    if (r.ok) {
      setMessage(r.data.code === 'ADDED' ? `✓ They already have an account and are now staff.` : `✓ Invited. They get access when they sign in with that email.`);
      setEmail('');
    } else setMessage(r.status === 400 ? '✕ Enter a valid email.' : `✕ ${errorText(r)}`);
    await load();
  }

  async function confirm(p: NonNullable<Pending>) {
    setPending(null);
    const r =
      p.kind === 'remove'
        ? await api<{ code: string }>(adminUrl(slug, `/staff/${p.userId}`), { method: 'DELETE' })
        : await api<{ code: string }>(adminUrl(slug, `/staff/invites/${encodeURIComponent(p.email)}`), { method: 'DELETE' });
    if (r.ok) setMessage(p.kind === 'remove' ? `✓ Removed ${p.name}. Their next scan will be refused.` : '✓ Invite cancelled.');
    else setMessage(r.data.code === 'LAST_ORGANIZER' ? '✕ You can’t remove the last organizer.' : `✕ ${errorText(r)}`);
    await load();
  }

  return (
    <>
      <h1>Staff</h1>
      <form
        className={styles.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          void invite();
        }}
      >
        <label className={styles.field}>
          Email
          <input className={styles.input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className={styles.field}>
          Role
          <select className={styles.input} value={role} onChange={(e) => setRole(e.target.value as 'volunteer' | 'organizer')}>
            <option value="volunteer">volunteer</option>
            <option value="organizer">organizer</option>
          </select>
        </label>
        <button type="submit">Invite</button>
      </form>
      {message && (
        <p className={styles.alert + ' ' + (message.startsWith('✓') ? styles.alertOk : styles.alertWarn)} role="status">
          {message}
        </p>
      )}
      {!data ? (
        <p>Loading…</p>
      ) : (
        <>
          <h2>Team</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.staff.map((s) => {
                  const name = s.displayName ?? '(no name yet)';
                  return (
                    <tr key={s.userId}>
                      <td>
                        {name}
                        {s.isMe && <span className={styles.muted}> (you)</span>}
                      </td>
                      <td>{s.role}</td>
                      <td>
                        {!s.isMe && (
                          <button type="button" className={`${styles.danger} ${styles.small}`} aria-label={`Remove ${name}`} onClick={() => setPending({ kind: 'remove', userId: s.userId, name })}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h2>Pending invites</h2>
          {data.invites.length === 0 ? (
            <p className={styles.muted}>None.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <tbody>
                  {data.invites.map((i) => (
                    <tr key={i.email}>
                      <td>{i.email}</td>
                      <td>{i.role}</td>
                      <td>
                        <button type="button" className={`${styles.secondary} ${styles.small}`} aria-label={`Cancel invite for ${i.email}`} onClick={() => setPending({ kind: 'cancel', email: i.email })}>
                          Cancel invite
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {pending && (
        <ConfirmDialog
          title={pending.kind === 'remove' ? `Remove ${pending.name}?` : `Cancel the invite for ${pending.email}?`}
          body={<p>{pending.kind === 'remove' ? 'They lose access immediately. Their past scans stay.' : 'They won’t get access when they sign in.'}</p>}
          confirmLabel={pending.kind === 'remove' ? 'Remove' : 'Cancel invite'}
          danger
          onConfirm={() => void confirm(pending)}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}

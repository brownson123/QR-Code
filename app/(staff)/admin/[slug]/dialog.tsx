'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './admin.module.css';

// A modal <dialog>, opened on mount. Escape = cancel.
export function Modal(props: { title: string; onCancel: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={props.title}
      onCancel={(e) => {
        e.preventDefault();
        props.onCancel();
      }}
    >
      <h2>{props.title}</h2>
      {props.children}
    </dialog>
  );
}

// Every destructive admin action goes through this. `typeToConfirm` adds a typed safeguard.
export function ConfirmDialog(props: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ok = !props.typeToConfirm || typed.trim() === props.typeToConfirm;
  return (
    <Modal title={props.title} onCancel={props.onCancel}>
      <div>{props.body}</div>
      {props.typeToConfirm && (
        <label className={styles.field}>
          Type {props.typeToConfirm} to confirm
          <input className={styles.input} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
      )}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.secondary} onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" className={props.danger ? styles.danger : undefined} disabled={!ok} onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

const QUICK = ['Wrong checkpoint', 'Wrong person', 'Test scan'] as const;

// F11: a reason (3–200 chars) is required; quick picks as in the scanner (§10.3).
export function VoidDialog(props: { what: string; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [other, setOther] = useState('');
  const valid = other.trim().length >= 3 && other.trim().length <= 200;
  return (
    <Modal title={`Void ${props.what}`} onCancel={props.onCancel}>
      <p>Why are you voiding it? The scan stays in the history, but it no longer counts.</p>
      <div className={styles.dialogForm}>
        {QUICK.map((r) => (
          <button key={r} type="button" className={styles.secondary} onClick={() => props.onSubmit(r)}>
            {r}
          </button>
        ))}
        <label className={styles.field}>
          Other reason
          <input className={styles.input} value={other} maxLength={200} onChange={(e) => setOther(e.target.value)} />
        </label>
        <button type="button" disabled={!valid} onClick={() => props.onSubmit(other.trim())}>
          Void with this reason
        </button>
      </div>
      <div className={styles.dialogActions}>
        <button type="button" className={styles.secondary} onClick={props.onCancel}>
          Keep the scan
        </button>
      </div>
    </Modal>
  );
}

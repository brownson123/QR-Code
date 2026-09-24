'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './scanner.module.css';

const QUICK = ['Wrong checkpoint', 'Wrong person', 'Test scan'] as const;

// SPEC §10.3: a reason is required (3–200 chars); quick picks or "Other".
export function UndoDialog(props: { onSubmit: (reason: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [other, setOther] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const otherValid = other !== null && other.trim().length >= 3 && other.trim().length <= 200;

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="undo-title"
      onCancel={(e) => {
        e.preventDefault();
        props.onCancel();
      }}
    >
      <h2 id="undo-title">Undo last scan</h2>
      <p>Why are you undoing it?</p>
      <div className={styles.choiceList}>
        {QUICK.map((r) => (
          <button key={r} type="button" className={styles.choice} onClick={() => props.onSubmit(r)}>
            {r}
          </button>
        ))}
        {other === null ? (
          <button type="button" className={styles.choice} onClick={() => setOther('')}>
            Other…
          </button>
        ) : (
          <>
            <label htmlFor="undo-other">Reason</label>
            <input id="undo-other" className={styles.searchInput} value={other} maxLength={200} onChange={(e) => setOther(e.target.value)} autoFocus />
            <button type="button" disabled={!otherValid} onClick={() => props.onSubmit(other.trim())}>
              Undo with this reason
            </button>
          </>
        )}
      </div>
      <div className={styles.dialogActions}>
        <button type="button" className={styles.secondary} onClick={props.onCancel}>
          Keep the scan
        </button>
      </div>
    </dialog>
  );
}

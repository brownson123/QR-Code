'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './scanner.module.css';
import { KIND_ICON, KIND_LABEL, type Checkpoint } from './types';

// SPEC §10.1: switching checkpoint requires confirmation (unless none is selected yet).
export function CheckpointPicker(props: {
  checkpoints: Checkpoint[];
  currentId: string | null;
  onChoose: (id: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<Checkpoint | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  function pick(cp: Checkpoint) {
    if (props.currentId === null) props.onChoose(cp.id);
    else if (cp.id !== props.currentId) setPending(cp);
    else props.onCancel();
  }

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="picker-title"
      onCancel={(e) => {
        e.preventDefault();
        if (props.currentId !== null) props.onCancel();
      }}
    >
      {pending ? (
        <>
          <h2 id="picker-title">Switch to {pending.name}?</h2>
          <p>New scans will be recorded at {pending.name}.</p>
          <div className={styles.dialogActions}>
            <button type="button" className={styles.secondary} onClick={() => setPending(null)}>
              Back
            </button>
            <button type="button" onClick={() => props.onChoose(pending.id)}>
              Switch to {pending.name}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 id="picker-title">Choose your checkpoint</h2>
          {props.checkpoints.length === 0 && <p>This event has no checkpoints yet. Ask an organizer.</p>}
          <div className={styles.choiceList}>
            {props.checkpoints.map((cp) => (
              <button
                key={cp.id}
                type="button"
                className={styles.choice}
                aria-pressed={cp.id === props.currentId}
                onClick={() => pick(cp)}
              >
                <span aria-hidden="true">{KIND_ICON[cp.kind]}</span>
                <span>
                  {cp.name} <small>· {KIND_LABEL[cp.kind]}{cp.isOpen ? '' : ' · closed'}</small>
                </span>
              </button>
            ))}
          </div>
          {props.currentId !== null && (
            <div className={styles.dialogActions}>
              <button type="button" className={styles.secondary} onClick={props.onCancel}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </dialog>
  );
}

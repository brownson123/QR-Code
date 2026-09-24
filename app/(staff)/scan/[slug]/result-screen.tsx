'use client';

import Image from 'next/image';
import type { ResultView } from '@/lib/scanner/result-view';
import styles from './scanner.module.css';

// SPEC §10.2: icon + text + colour together; names ≥ 32 px, photo ≥ 160 px. Only green (and the
// "Not a Passline code" notice) auto-dismiss; every problem needs a tap so the volunteer notices it.
export function ResultScreen({ view, shownAt, onDismiss }: { view: ResultView; shownAt: number; onDismiss: () => void }) {
  const tap = view.dismiss === 'tap';
  return (
    <button
      type="button"
      className={styles.result}
      data-tone={view.tone}
      data-testid="scan-result"
      data-shown-at={shownAt}
      data-dismiss={tap ? 'tap' : 'auto'}
      onClick={onDismiss}
      aria-describedby="result-hint"
    >
      <span className={styles.resultIcon} aria-hidden="true">
        {view.icon}
      </span>
      <span role="status" aria-live="assertive">
        <strong className={styles.resultHeadline}>{view.headline}</strong>
      </span>
      {view.photoUrl && <Image className={styles.resultPhoto} src={view.photoUrl} alt="" width={180} height={180} unoptimized />}
      {view.name && <span className={styles.resultName}>{view.name}</span>}
      {view.emphasis && <span className={styles.resultEmphasis}>{view.emphasis}</span>}
      {view.detail && <span className={styles.resultDetail}>{view.detail}</span>}
      <span id="result-hint" className={styles.resultHint}>
        {tap ? 'Tap to continue' : 'Tap to skip'}
      </span>
    </button>
  );
}

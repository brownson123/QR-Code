'use client';

import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { parseScannedText } from '@/lib/domain/scanned-text';
import type { ScanRequest } from '@/lib/scan/schema';
import { createDeduper } from '@/lib/scanner/dedupe';
import { playFeedback, unlockAudio } from '@/lib/scanner/feedback';
import { CameraError, createBarcodeScanner, type BarcodeScanner, type CameraFailure } from '@/lib/scanner/qr-scanner';
import { viewFor, type Outcome, type ResultView } from '@/lib/scanner/result-view';
import { submitScan } from '@/lib/scanner/submit';
import { undoVisible } from '@/lib/scanner/undo';
import { keepScreenAwake } from '@/lib/scanner/wake-lock';
import { CheckpointPicker } from './checkpoint-picker';
import { ManualSearch } from './manual-search';
import { ResultScreen } from './result-screen';
import styles from './scanner.module.css';
import { CAMERA_KEY, checkpointKey, KIND_LABEL, readPref, writePref, type Checkpoint } from './types';
import { UndoDialog } from './undo-dialog';

type CameraState = 'starting' | 'ready' | CameraFailure;

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

const CAMERA_HELP: Record<CameraFailure, string> = {
  denied: 'Camera access is blocked. Allow the camera for this site in your browser settings, then reload. You can still use Manual search.',
  unavailable: 'No camera found or it is in use by another app. You can still use Manual search.',
  other: "The camera couldn't start. Reload the page, or use Manual search.",
};

export function Scanner(props: { slug: string; eventName: string; timezone: string; appOrigin: string }) {
  const { slug, timezone, appOrigin } = props;
  const [checkpoints, setCheckpoints] = useState<Checkpoint[] | null>(null);
  const [checkpointId, setCheckpointId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [result, setResult] = useState<{ view: ResultView; id: number; shownAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [networkDown, setNetworkDown] = useState(false);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [cameraReadyAt, setCameraReadyAt] = useState<number | null>(null);
  const [checkpointSetAt, setCheckpointSetAt] = useState<number | null>(null);
  const [lastOwn, setLastOwn] = useState<{ at: number; scanId: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);

  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const offline = !online || networkDown;

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<BarcodeScanner | null>(null);
  const deduper = useRef(createDeduper());
  const resultSeq = useRef(0);
  const checkpoint = checkpoints?.find((c) => c.id === checkpointId) ?? null;

  const router = useRouter();
  const toLogin = useCallback(() => {
    router.push(`/login?next=${encodeURIComponent(`/scan/${slug}`)}`);
  }, [router, slug]);

  // When scanning actually became possible (camera ready AND a checkpoint chosen); T-SCUI-01 timing.
  const activeAt = cameraReadyAt !== null && checkpointSetAt !== null ? Math.max(cameraReadyAt, checkpointSetAt) : null;

  // Checkpoints for this event; restore this device's last choice (§10.1).
  useEffect(() => {
    let stale = false;
    void fetch(`/api/events/${encodeURIComponent(slug)}/checkpoints`, { cache: 'no-store' }).then(async (res) => {
      if (stale) return;
      if (res.status === 401) return toLogin();
      const list = res.ok ? ((await res.json()) as { checkpoints: Checkpoint[] }).checkpoints : [];
      if (stale) return;
      setCheckpoints(list);
      const saved = readPref(checkpointKey(slug));
      if (saved && list.some((c) => c.id === saved)) {
        setCheckpointId(saved);
        setCheckpointSetAt(performance.now());
      } else setPickerOpen(true);
    });
    return () => {
      stale = true;
    };
  }, [slug, toLogin]);

  // Keep the session cookie fresh during a long shift (access tokens expire hourly).
  useEffect(() => {
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '');
    void supabase.auth.getSession();
    return () => void supabase.auth.stopAutoRefresh();
  }, []);

  useEffect(() => {
    if (!networkDown) return;
    const clear = () => setNetworkDown(false);
    window.addEventListener('online', clear);
    return () => window.removeEventListener('online', clear);
  }, [networkDown]);

  const show = useCallback((outcome: Outcome, cp: Checkpoint) => {
    const view = viewFor(outcome, { checkpointKind: cp.kind, checkpointName: cp.name, timezone, now: new Date() });
    const id = ++resultSeq.current;
    setResult({ view, id, shownAt: performance.now() });
    playFeedback(view.sound);
    if (view.dismiss !== 'tap') {
      setTimeout(() => setResult((r) => (r?.id === id ? null : r)), view.dismiss.autoMs);
    }
  }, [timezone]);

  const record = useCallback(
    async (part: Pick<ScanRequest, 'method' | 'token' | 'participantId'>) => {
      if (!checkpoint) return;
      setBusy(true);
      setNotice(null);
      // A new physical scan gets a new clientScanId; submitScan's retries reuse it (§10.2).
      const outcome = await submitScan({
        checkpointId: checkpoint.id,
        ...part,
        clientScanId: crypto.randomUUID(),
        clientScannedAt: new Date().toISOString(),
      });
      setBusy(false);
      if (outcome.kind === 'unauthorized') return toLogin();
      if (outcome.kind === 'offline') {
        setNetworkDown(true);
        return show({ kind: 'network' }, checkpoint);
      }
      if (outcome.kind === 'response') {
        if (outcome.data.code === 'ACCEPTED' && outcome.data.scanId && !outcome.data.voided) {
          setLastOwn({ at: Date.now(), scanId: outcome.data.scanId });
          setNow(Date.now());
        }
        return show({ kind: 'server', data: outcome.data }, checkpoint);
      }
      show({ kind: outcome.kind }, checkpoint);
    },
    [checkpoint, show, toLogin],
  );

  const scanningPaused = !!result || busy || offline || pickerOpen || searchOpen || undoOpen || !checkpoint;
  const onDecode = useRef<(text: string) => void>(() => undefined);
  useEffect(() => {
    onDecode.current = (text: string) => {
      if (scanningPaused || !checkpoint) return;
      if (!deduper.current.shouldHandle(text, Date.now())) return;
      const parsed = parseScannedText(text, appOrigin);
      // MALFORMED never makes a network request (§6.4).
      if (!parsed.ok) return show({ kind: 'malformed' }, checkpoint);
      void record({ method: 'qr', token: parsed.token });
    };
  }, [scanningPaused, checkpoint, appOrigin, record, show]);

  // Camera: started once; decoding pauses while anything else is on screen (§10.2).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = createBarcodeScanner({ deviceId: readPref(CAMERA_KEY) });
    scannerRef.current = scanner;
    let cancelled = false;
    scanner
      .start(video, (text) => onDecode.current(text))
      .then(async () => {
        if (cancelled) return;
        setCamera('ready');
        setCameraReadyAt(performance.now());
        const [track] = (video.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks() : []) ?? [];
        const deviceId = track?.getSettings().deviceId;
        if (deviceId) writePref(CAMERA_KEY, deviceId);
      })
      .catch((err: unknown) => {
        if (!cancelled) setCamera(err instanceof CameraError ? err.reason : 'other');
      });
    return () => {
      cancelled = true;
      void scanner.stop();
    };
  }, []);

  useEffect(() => {
    scannerRef.current?.setPaused(scanningPaused);
  }, [scanningPaused]);

  useEffect(() => (camera === 'ready' ? keepScreenAwake() : undefined), [camera]);

  // Tick while an undo is possible so the button hides at 120 s (§10.3).
  useEffect(() => {
    if (!lastOwn) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lastOwn]);

  function dismiss() {
    const action = result?.view.action;
    setResult(null);
    if (action === 'pick-checkpoint') setPickerOpen(true);
    if (action === 'manual-search') setSearchOpen(true);
  }

  function chooseCheckpoint(id: string) {
    writePref(checkpointKey(slug), id);
    setCheckpointId(id);
    setCheckpointSetAt(performance.now());
    setPickerOpen(false);
    setLastOwn(null);
  }

  async function undo(reason: string) {
    if (!lastOwn) return;
    setUndoOpen(false);
    const res = await fetch(`/api/scans/${lastOwn.scanId}/void`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    }).catch(() => null);
    if (!res) return setNotice('✕ Undo failed: no connection.');
    if (res.status === 401) return toLogin();
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === 'VOIDED' || body.code === 'ALREADY_VOIDED') {
      setLastOwn(null);
      setNotice('✓ Last scan undone.');
    } else if (body.code === 'FORBIDDEN') {
      setLastOwn(null);
      setNotice('✕ Too late to undo. Ask an organizer.');
    } else {
      setNotice('✕ Undo failed. Try again.');
    }
  }

  const showUndo = undoVisible(lastOwn, now) && !offline;

  return (
    <main
      className={styles.root}
      onPointerDown={unlockAudio}
      data-camera={camera}
      data-scanning={scanningPaused ? 'paused' : 'on'}
      data-active-at={activeAt ?? undefined}
    >
      <header className={styles.banner} data-kind={checkpoint?.kind ?? 'none'} data-testid="checkpoint-banner">
        <span className={styles.bannerText}>
          <span className={styles.bannerKind}>
            {checkpoint ? `${KIND_LABEL[checkpoint.kind]}${checkpoint.isOpen ? '' : ' · closed'}` : props.eventName}
          </span>
          <span className={styles.bannerName}>{checkpoint?.name ?? 'No checkpoint selected'}</span>
        </span>
        <button type="button" className={styles.bannerButton} onClick={() => setPickerOpen(true)} disabled={!checkpoints}>
          Change
        </button>
      </header>

      {offline && (
        <div className={styles.offline} role="alert">
          ⚠ OFFLINE: use paper list
        </div>
      )}

      <div className={styles.viewport}>
        <video ref={videoRef} className={styles.video} playsInline muted aria-label="Camera view" />
        {camera !== 'starting' && camera !== 'ready' && (
          <div className={styles.viewportMessage} role="alert">
            <p>📷 {CAMERA_HELP[camera]}</p>
          </div>
        )}
        <div className={styles.status} aria-live="polite">
          {busy ? 'Checking…' : camera === 'starting' ? 'Starting camera…' : camera === 'ready' && checkpoint ? 'Ready to scan' : ''}
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={() => setSearchOpen(true)} disabled={offline || !checkpoint}>
          Manual search
        </button>
        {showUndo && (
          <button type="button" className={styles.secondary} onClick={() => setUndoOpen(true)}>
            Undo last
          </button>
        )}
      </div>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {pickerOpen && checkpoints && (
        <CheckpointPicker checkpoints={checkpoints} currentId={checkpointId} onChoose={chooseCheckpoint} onCancel={() => setPickerOpen(false)} />
      )}
      {searchOpen && checkpoint && (
        <ManualSearch
          slug={slug}
          checkpointId={checkpoint.id}
          disabled={offline || busy}
          onUnauthorized={toLogin}
          onClose={() => setSearchOpen(false)}
          onRecord={(participantId) => {
            setSearchOpen(false);
            void record({ method: 'manual', participantId });
          }}
        />
      )}
      {undoOpen && <UndoDialog onSubmit={(r) => void undo(r)} onCancel={() => setUndoOpen(false)} />}
      {result && <ResultScreen view={result.view} shownAt={result.shownAt} onDismiss={dismiss} />}
    </main>
  );
}

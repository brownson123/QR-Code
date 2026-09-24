// SPEC §10.1 / §17 A4: keep the screen on while scanning where supported; the lock is dropped whenever
// the page is hidden, so re-acquire it on visibilitychange. Returns a cleanup function.
export function keepScreenAwake(): () => void {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return () => undefined;
  let lock: WakeLockSentinel | null = null;
  let active = true;
  const acquire = async () => {
    if (!active || document.visibilityState !== 'visible') return;
    try {
      lock = await navigator.wakeLock.request('screen');
    } catch {
      lock = null; // battery saver or unsupported: volunteers are told to extend auto-lock (A4)
    }
  };
  const onVisibility = () => void acquire();
  document.addEventListener('visibilitychange', onVisibility);
  void acquire();
  return () => {
    active = false;
    document.removeEventListener('visibilitychange', onVisibility);
    void lock?.release();
  };
}

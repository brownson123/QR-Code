// SPEC §10.2: ignore an identical decode within 3 s. Every identical decode refreshes the window, so
// a code that stays in frame produces exactly one scan (T-SCUI-02); it counts as new only after it
// has been out of frame for 3 s.
export const DEDUPE_WINDOW_MS = 3000;

export function createDeduper(windowMs = DEDUPE_WINDOW_MS) {
  let last: { text: string; seenAt: number } | null = null;
  return {
    shouldHandle(text: string, nowMs: number): boolean {
      if (last && last.text === text && nowMs - last.seenAt < windowMs) {
        last.seenAt = nowMs;
        return false;
      }
      last = { text, seenAt: nowMs };
      return true;
    },
  };
}

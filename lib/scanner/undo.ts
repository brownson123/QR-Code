// SPEC §10.3 / F11: "Undo last" shows for 120 s after the volunteer's own accepted scan.
// The server enforces the same window in void_scan(); this only decides visibility.
export const UNDO_WINDOW_MS = 120_000;

export function undoVisible(lastOwnAccepted: { at: number } | null, nowMs: number): boolean {
  return lastOwnAccepted !== null && nowMs - lastOwnAccepted.at <= UNDO_WINDOW_MS;
}

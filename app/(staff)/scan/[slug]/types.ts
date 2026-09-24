import type { CheckpointKind } from '@/lib/scanner/result-view';

export interface Checkpoint {
  id: string;
  name: string;
  kind: CheckpointKind;
  isOpen: boolean;
  requiresCheckin: boolean;
  capacity: number | null;
}

export const KIND_LABEL: Record<CheckpointKind, string> = { door: 'Door', meal: 'Meal', session: 'Session', custom: 'Custom' };
export const KIND_ICON: Record<CheckpointKind, string> = { door: '🚪', meal: '🍽', session: '🎤', custom: '★' };

// localStorage holds scanner preferences only (CLAUDE.md), never participant data.
export const checkpointKey = (slug: string) => `passline:checkpoint:${slug}`;
export const CAMERA_KEY = 'passline:camera';

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode: the preference just isn't remembered
  }
}

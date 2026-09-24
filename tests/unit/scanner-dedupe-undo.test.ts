import { describe, expect, it } from 'vitest';
import { createDeduper } from '@/lib/scanner/dedupe';
import { undoVisible, UNDO_WINDOW_MS } from '@/lib/scanner/undo';

describe('decode dedupe (SPEC §10.2)', () => {
  it('T-SCUI-02: an identical decode within 3 s is ignored, and a code held in frame keeps being ignored', () => {
    const d = createDeduper();
    expect(d.shouldHandle('A', 0)).toBe(true);
    expect(d.shouldHandle('A', 2900)).toBe(false);
    for (let t = 3000; t <= 10_000; t += 100) expect(d.shouldHandle('A', t)).toBe(false);
    expect(d.shouldHandle('B', 10_050)).toBe(true);
  });

  it('T-SCUI-02: the same code shown again after 3 s out of frame is a new scan', () => {
    const d = createDeduper();
    expect(d.shouldHandle('A', 0)).toBe(true);
    expect(d.shouldHandle('A', 3001)).toBe(true);
  });
});

describe('undo window (SPEC §10.3)', () => {
  it('T-SCUI-09: visible from 0 to 120 s after my own accepted scan, hidden after; hidden with no scan', () => {
    expect(UNDO_WINDOW_MS).toBe(120_000);
    expect(undoVisible({ at: 1000 }, 1000)).toBe(true);
    expect(undoVisible({ at: 1000 }, 121_000)).toBe(true);
    expect(undoVisible({ at: 1000 }, 121_001)).toBe(false);
    expect(undoVisible(null, 5)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeEmail, toSearchText } from '@/lib/domain/normalize';

describe('normalizers (I-12)', () => {
  it('T-SRCH-01: toSearchText("Zoë O\'Brien-Smith") is "zoe o brien smith"', () => {
    expect(toSearchText("Zoë O'Brien-Smith")).toBe('zoe o brien smith');
  });

  it('T-SRCH-01: keeps non-Latin letters and collapses whitespace', () => {
    expect(toSearchText('  李雷   Adebayo ')).toBe('李雷 adebayo');
    expect(toSearchText('Ｆｕｌｌｗｉｄｔｈ')).toBe('fullwidth');
  });

  it('T-SRCH-01: Hangul stays composed (NFKD would split syllables into jamo)', () => {
    expect(toSearchText('김민준')).toBe('김민준');
    expect([...toSearchText('김')]).toHaveLength(1);
  });

  it('T-ING-12: normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail(' Ade@Gmail.COM ')).toBe('ade@gmail.com');
  });
});

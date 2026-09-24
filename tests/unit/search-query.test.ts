import { describe, expect, it } from 'vitest';
import { searchQuery } from '@/lib/domain/search';

describe('manual search query (SPEC §10.4, decision: 1 char allowed for CJK/Hangul)', () => {
  it('T-SRCH-03: fewer than 2 normalized characters is rejected (null)', () => {
    expect(searchQuery('a')).toBeNull();
    expect(searchQuery(' é ')).toBeNull();
    expect(searchQuery("'-")).toBeNull();
    expect(searchQuery('')).toBeNull();
  });

  it('T-SRCH-02: a single Han, kana or Hangul character is allowed; 2+ characters are normalized', () => {
    expect(searchQuery('李')).toBe('李');
    expect(searchQuery('ア')).toBe('ア');
    expect(searchQuery('김')).toBe('김');
    expect(searchQuery("  O'Brien ")).toBe('o brien');
    expect(searchQuery('Zoë')).toBe('zoe');
  });

  it('T-SRCH-03: very long queries are capped', () => {
    expect(searchQuery('x'.repeat(500))?.length).toBe(100);
  });
});

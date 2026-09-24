import { describe, expect, it } from 'vitest';
import { maskEmail } from '@/lib/domain/mask';

describe('maskEmail (SPEC §10.4)', () => {
  it('T-SRCH-06: volunteers see the first character and the domain only', () => {
    expect(maskEmail('ada@gmail.com')).toBe('a***@gmail.com');
    expect(maskEmail('a@x.co')).toBe('a***@x.co');
    expect(maskEmail('zoë.o+tag@uni.edu')).toBe('z***@uni.edu');
  });

  it('T-SRCH-06: malformed input never leaks the local part', () => {
    expect(maskEmail('no-at-sign')).toBe('***');
    expect(maskEmail('@domain.only')).toBe('***@domain.only');
    expect(maskEmail('')).toBe('***');
  });
});
